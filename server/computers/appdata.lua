---@type table sd-computers config root (configs/config.lua).
local config = require 'configs.config'

-- What a custom app keeps with computer.storage (web/build/sdk/sdcomputers.js): small values under
-- names, kept for the app either per character - they follow that character to every computer -
-- or per machine, where everyone who uses that computer sees the same ones. A value arrives as
-- the JSON text the page made of it and is handed back as that text: nothing here reads it.

---@type table Storage limits (configs/shared/apps.lua Storage).
local S = (config.Apps or {}).Storage or {}
---@type integer Most names one app keeps for one owner.
local MAX_KEYS = math.max(1, math.floor(tonumber(S.MaxKeys) or 64))
---@type integer Most bytes (names and values together) one app keeps for one owner.
local MAX_BYTES = math.max(1024, math.floor(tonumber(S.MaxBytes) or 65536))
---@type integer Longest name.
local MAX_KEY = 64

---@type table App storage module; the table returned at end of file.
local appdata = {}

---@type table<string, boolean> '<app>|<owner>' -> a write is being made. Writes for one owner take
---turns: the size check and the write are two queries, and two writes in between them could each
---pass the check that together they would fail.
local writing = {}

---Create the table if it doesn't exist, so the resource stays drop-in. Run once at boot.
function appdata.ensureSchema()
    MySQL.query.await([[
        CREATE TABLE IF NOT EXISTS computers_app_data (
            app        VARCHAR(48)  NOT NULL,
            owner      VARCHAR(160) NOT NULL,
            k          VARCHAR(64)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            v          MEDIUMTEXT   NOT NULL,
            updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (app, owner, k)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ]])
end

---Whether a name is one a value can be kept under.
---@param key any
---@return boolean
function appdata.validKey(key)
    return type(key) == 'string' and key ~= '' and #key <= MAX_KEY and not key:find('%c')
end

---The owner a scope names: a character ('c:<citizenid>') or a machine ('m:<instance>').
---@param scope any 'character' (default) | 'computer'
---@param s ComputerSession
---@return string|nil owner nil for a scope that is neither
function appdata.owner(scope, s)
    if scope == nil or scope == 'character' then return 'c:' .. s.citizenid end
    if scope == 'computer' then return 'm:' .. s.instance end
    return nil
end

---A value, as the text it was kept as (nil when there is none).
---@param app string app id
---@param owner string
---@param key string
---@return string|nil
function appdata.get(app, owner, key)
    return MySQL.scalar.await('SELECT v FROM computers_app_data WHERE app = ? AND owner = ? AND k = ?', { app, owner, key })
end

---Every name an app keeps for an owner, A to Z.
---@param app string
---@param owner string
---@return string[]
function appdata.keys(app, owner)
    local rows = MySQL.query.await(
        'SELECT k FROM computers_app_data WHERE app = ? AND owner = ? ORDER BY k',
        { app, owner }) or {}
    local out = {}
    for i, r in ipairs(rows) do out[i] = r.k end
    return out
end

---Keep a value (nil takes the name away). Refused when it would take the app past its limits.
---@param app string
---@param owner string
---@param key string
---@param value string|nil
---@return boolean ok
---@return string|nil why locale key
local function set(app, owner, key, value)
    if value == nil then
        MySQL.prepare.await('DELETE FROM computers_app_data WHERE app = ? AND owner = ? AND k = ?', { app, owner, key })
        return true
    end
    -- (how many names and bytes the owner has, and how much of that is the name being written)
    local use = MySQL.single.await([[
        SELECT COUNT(*) AS n,
               COALESCE(SUM(LENGTH(k) + LENGTH(v)), 0) AS bytes,
               COALESCE(SUM(CASE WHEN k = ? THEN LENGTH(k) + LENGTH(v) ELSE 0 END), 0) AS mine,
               COALESCE(SUM(k = ?), 0) AS had
        FROM computers_app_data WHERE app = ? AND owner = ?
    ]], { key, key, app, owner }) or {}
    local had = (tonumber(use.had) or 0) > 0
    local keys = (tonumber(use.n) or 0) + (had and 0 or 1)
    local bytes = (tonumber(use.bytes) or 0) - (tonumber(use.mine) or 0) + #key + #value
    if keys > MAX_KEYS or bytes > MAX_BYTES then return false, 'apps.storage_full' end
    MySQL.prepare.await(
        'INSERT INTO computers_app_data (app, owner, k, v) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
        { app, owner, key, value })
    return true
end

---Keep a value, one write per app and owner at a time (see `writing`).
---@param app string
---@param owner string
---@param key string
---@param value string|nil
---@return boolean ok
---@return string|nil why locale key
function appdata.set(app, owner, key, value)
    local lock = app .. '|' .. owner
    local waited = 0
    while writing[lock] do
        if waited >= 500 then return false, 'err.internal' end
        waited = waited + 1
        Wait(10)
    end
    writing[lock] = true
    local ok, done, why = pcall(set, app, owner, key, value)
    writing[lock] = nil
    if not ok then error(done) end
    return done, why
end

---Take every name an app keeps for an owner away.
---@param app string
---@param owner string
function appdata.clear(app, owner)
    MySQL.prepare.await('DELETE FROM computers_app_data WHERE app = ? AND owner = ?', { app, owner })
end

---The limits, for the page (computer.storage.limits).
---@return { maxKeys: integer, maxBytes: integer, maxKey: integer }
function appdata.limits()
    return { maxKeys = MAX_KEYS, maxBytes = MAX_BYTES, maxKey = MAX_KEY }
end

return appdata
