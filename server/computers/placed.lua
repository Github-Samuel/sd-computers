---@type table sd-computers config root (configs/config.lua).
local config = require 'configs.config'
---@type table Console log helper (shared.log): tagged color-coded prints.
local log = require 'shared.log'
---@type table Computer definitions (server.computers.registry).
local registry = require 'server.computers.registry'
---@type table The prop models known as a computer (shared.props): what a world prop may be picked as.
local props = require 'shared.props'

---@type table Admin config (config.Admin): the props a computer can be placed as, label length.
local A = config.Admin or {}
---@type string GlobalState key the placed computers are published under (clients spawn their props from it).
local STATE_KEY = 'sd-computers:placed'
---@type number Metres within which a picked prop is the one already picked.
local SAME_PROP = 0.3
---@type string What the panel and the `boss` column say for "whatever job the signed-in player has".
local ANY_BOSS = '*'

-- Computers made from the admin panel (/computeradmin): a prop, an OS style, an optional job lock
-- and an optional Business Manager at a spot an admin picked. Two kinds, kept in one table: PLACED ones, whose prop is put
-- there with the placement gizmo, and PICKED ones (`world`), which are a prop the game already has
-- in the world - nothing is spawned for those, the prop standing there is the computer. They are
-- kept in the database beside everything else the resource stores, and registered with the
-- registry as LOCATION computers - so opening one goes through exactly the checks a computers.lua
-- entry does: reach is measured from the computer's own coords (never the client's), the job lock
-- is enforced, one user at a time. The prop itself is local to each client
-- (client/computers/placed.lua), so nothing syncs.

---@type table Placed-computer module; the table returned at end of file.
local placed = {}

---@class PlacedComputer
---@field id integer row id
---@field key string registry id ('placed_<id>'): keys its System Logs like any computer id
---@field label string
---@field hostname string
---@field prop string model name (one of config.Admin.Props; a picked one may be any model known as a computer)
---@field world boolean picked: a prop the game has there already, rather than one stood there
---@field style string|nil Desktop.Styles key; nil = Desktop.DefaultStyle
---@field coords { x: number, y: number, z: number, w: number } the prop's origin and heading
---@field groups table<string, integer>|nil job lock, ox_target style
---@field boss string|boolean|nil Business Manager: a job name, true = the signed-in player's own job, nil = none
---@field def table the registry entry (the same table for its whole life: open sessions hold it)

---@type table<integer, PlacedComputer>
local list = {}

---Create the table if it doesn't exist, so the resource stays drop-in. Run once at boot.
function placed.ensureSchema()
    MySQL.query.await([[
        CREATE TABLE IF NOT EXISTS computers_placed (
            id         INT          NOT NULL AUTO_INCREMENT,
            label      VARCHAR(64)  NOT NULL,
            hostname   VARCHAR(48)  NOT NULL,
            prop       VARCHAR(64)  NOT NULL,
            style      VARCHAR(24)  NULL,
            x          DOUBLE       NOT NULL,
            y          DOUBLE       NOT NULL,
            z          DOUBLE       NOT NULL,
            heading    FLOAT        NOT NULL DEFAULT 0,
            world      TINYINT(1)   NOT NULL DEFAULT 0,
            access     TEXT         NULL,
            boss       VARCHAR(48)  NULL,
            created_by VARCHAR(96)  NULL,
            created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ]])
    -- (a table made before props could be picked from the world has no `world` column yet)
    local has = MySQL.query.await("SHOW COLUMNS FROM computers_placed LIKE 'world'")
    if not has or #has == 0 then
        MySQL.query.await('ALTER TABLE computers_placed ADD COLUMN world TINYINT(1) NOT NULL DEFAULT 0 AFTER heading')
    end
    -- (nor has one made before a computer could be given the Business Manager a `boss` column)
    has = MySQL.query.await("SHOW COLUMNS FROM computers_placed LIKE 'boss'")
    if not has or #has == 0 then
        MySQL.query.await('ALTER TABLE computers_placed ADD COLUMN boss VARCHAR(48) NULL AFTER access')
    end
end

-- ── What a record may hold ────────────────────────────────────────────────────────────────

---The entry of a prop a computer can be placed as: one from config.Admin.Props, or one an admin
---added from the panel (a computer can only be one of those).
---@param model any
---@return table|nil prop { model, label, kind }
function placed.prop(model)
    return props.placeable(model)
end

---Whether a placed or picked computer is this prop (a prop added from the panel cannot go then).
---@param model string
---@return boolean
function placed.usesProp(model)
    for _, r in pairs(list) do
        if r.prop == model then return true end
    end
    return false
end

---A label from the panel, trimmed and cut to length (nil when nothing is left).
---@param raw any
---@return string|nil
local function labelOf(raw)
    if type(raw) ~= 'string' then return nil end
    local label = raw:gsub('%c', ' '):gsub('^%s+', ''):gsub('%s+$', ''):sub(1, A.MaxLabel or 48)
    return label ~= '' and label or nil
end

---A style from the panel: a Desktop.Styles key, or nil for "whatever the default is".
---@param raw any
---@return string|nil style
---@return boolean ok false when it names a style that does not exist
local function styleOf(raw)
    if raw == nil or raw == '' or raw == false then return nil, true end
    if type(raw) == 'string' and (config.Desktop.Styles or {})[raw] then return raw, true end
    return nil, false
end

---A job lock from the panel ({ police = 0, ... }), cut down to what a lock can be.
---@param raw any
---@return table<string, integer>|nil groups nil = anyone
---@return boolean ok false when an entry is not a job name + grade
local function groupsOf(raw)
    if raw == nil then return nil, true end
    if type(raw) ~= 'table' then return nil, false end
    local out, n = {}, 0
    for name, grade in pairs(raw) do
        grade = tonumber(grade)
        if type(name) ~= 'string' or not name:match('^[%w_%-]+$') or #name > 48 or not grade or grade < 0 or grade > 100 then return nil, false end
        out[name] = math.floor(grade)
        n = n + 1
        if n > 16 then return nil, false end
    end
    return n > 0 and out or nil, true
end

---A Business Manager choice from the panel, as a computers.lua `boss` value: nil = none, true =
---whoever signs in manages their own job ('*' from the panel), else the one job managed from it.
---The job is taken as written, like a job of the lock: one the framework does not have (yet) just
---has no boss to show the app to.
---@param raw any
---@return string|boolean|nil boss
---@return boolean ok false when it is none of those
local function bossOf(raw)
    if raw == nil or raw == '' or raw == false then return nil, true end
    if raw == ANY_BOSS or raw == true then return true, true end
    if type(raw) ~= 'string' or not raw:match('^[%w_%-]+$') or #raw > 48 then return nil, false end
    return raw, true
end

---The machine name CMD and the logs show: the label as a hostname, plus the id so two never match.
---@param label string
---@param id integer
---@return string
local function hostnameOf(label, id)
    local slug = label:upper():gsub('[^%w]+', '-'):gsub('^%-+', ''):gsub('%-+$', ''):sub(1, 12):gsub('%-+$', '')
    return ('%s-%02d'):format(slug ~= '' and slug or 'PC', id)
end

---A transform from the panel as stored coords (nil when it is not one).
---@param at any { x, y, z, w|heading }
---@return table|nil coords { x, y, z, w }
local function coordsOf(at)
    if type(at) ~= 'table' and type(at) ~= 'vector4' then return nil end
    local x, y, z, w = tonumber(at.x), tonumber(at.y), tonumber(at.z), tonumber(at.w or at.heading)
    if not x or not y or not z then return nil end
    return { x = x + 0.0, y = y + 0.0, z = z + 0.0, w = ((w or 0.0) + 0.0) % 360.0 }
end

-- (the same rules for a computer another resource adds: server/computers/added.lua)
placed.labelOf, placed.styleOf, placed.groupsOf, placed.bossOf, placed.coordsOf = labelOf, styleOf, groupsOf, bossOf, coordsOf

-- ── Registry + state ──────────────────────────────────────────────────────────────────────

---Write a record's fields into its registry entry (in place: sessions that are open keep reading
---the same table, so a changed job lock applies to them at once).
---@param r PlacedComputer
local function apply(r)
    local def = r.def
    def.id, def.placed = r.key, r.id
    def.label, def.hostname = r.label, r.hostname
    def.coords, def.heading = vec3(r.coords.x, r.coords.y, r.coords.z), r.coords.w
    def.prop, def.style, def.groups = r.prop, r.style, r.groups
    def.boss = r.boss
    def.world = r.world or nil
end

---The computers other resources added (server/computers/added.lua sets this), published beside the
---placed ones: clients stand and target both the same way.
---@type fun(): table<string, table>
placed.extra = function() return {} end

---Publish the placed computers. String keys: a sparse integer-keyed table does not survive
---state-bag serialisation as a map.
local function publish()
    local out = placed.extra()
    for id, r in pairs(list) do
        out[tostring(id)] = { id = id, key = r.key, prop = r.prop, style = r.style, coords = r.coords, groups = r.groups, world = r.world or nil }
    end
    GlobalState[STATE_KEY] = out
end
placed.publish = publish

---Track a record: build its registry entry and add it.
---@param r table a PlacedComputer that has no key / def yet
---@return boolean ok
local function track(r)
    r.key, r.def = 'placed_' .. r.id, {}
    apply(r)
    if not registry.add(r.def) then
        log.warn('placed', 'computer id %s is already taken by configs/shared/computers.lua - placed computer %d skipped', r.key, r.id)
        return false
    end
    list[r.id] = r
    return true
end

---Load every placed computer from the database and publish them. Run once at boot.
function placed.load()
    local rows = MySQL.query.await('SELECT id, label, hostname, prop, style, x, y, z, heading, world, access, boss FROM computers_placed ORDER BY id') or {}
    for _, row in ipairs(rows) do
        local access = row.access and json.decode(row.access) or nil
        track({
            id = row.id, label = row.label, hostname = row.hostname, prop = row.prop,
            world = row.world == true or row.world == 1, -- (a TINYINT(1) comes back as either)
            style = select(1, styleOf(row.style)), groups = select(1, groupsOf(access)), boss = select(1, bossOf(row.boss)),
            coords = { x = row.x + 0.0, y = row.y + 0.0, z = row.z + 0.0, w = (row.heading or 0.0) + 0.0 },
        })
    end
    publish()
    if #rows > 0 then log.info('placed', '%d placed computer(s)', #rows) end
end

---@return table<integer, PlacedComputer> list every placed computer, by id
function placed.all() return list end

---@param id integer|nil
---@return PlacedComputer|nil
function placed.get(id) return id and list[id] or nil end

-- placed.onChanged(key, reason) hears that a computer moved or went, so whoever sits at it can be
-- stood up (server/admin/panel.lua wires it to session.closeComputer).
---@type fun(key: string, reason: string)
placed.onChanged = function() end

-- ── Changes (each returns ok, then a locale key saying why not) ───────────────────────────

---Make a new computer: place one (its prop is stood at the spot), or pick one (`world`: the spot
---is where a prop of that model already stands in the game's world, and that prop is it).
---@param d table { x, y, z, heading, label, prop, style?, jobs?, boss?, world? } from the panel
---@param by string|nil who made it (kept with the row)
---@return integer|nil id
---@return string|nil why locale key
function placed.create(d, by)
    local world = d.world == true
    local coords, label = coordsOf(d), labelOf(d.label)
    -- (a picked prop may be any model known as a computer; one stood here must be on the placing list)
    local model = world and (props.known(d.prop) and d.prop or nil) or (placed.prop(d.prop) or {}).model
    local style, styleOk = styleOf(d.style)
    local groups, groupsOk = groupsOf(d.jobs)
    local boss, bossOk = bossOf(d.boss)
    if not coords or not label or not model or not styleOk or not groupsOk or not bossOk then return nil, 'admin.bad_request' end
    if world then
        local at = vec3(coords.x, coords.y, coords.z)
        for _, other in pairs(list) do
            if other.world and other.prop == model and #(vec3(other.coords.x, other.coords.y, other.coords.z) - at) <= SAME_PROP then
                return nil, 'admin.already_computer'
            end
        end
    end

    local id = MySQL.insert.await(
        'INSERT INTO computers_placed (label, hostname, prop, style, x, y, z, heading, world, access, boss, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        { label, '', model, style, coords.x, coords.y, coords.z, coords.w, world and 1 or 0, groups and json.encode(groups) or nil, boss == true and ANY_BOSS or boss, by })
    if not id then return nil, 'admin.failed' end
    local r = { id = id, label = label, hostname = hostnameOf(label, id), prop = model, world = world, style = style, groups = groups, boss = boss, coords = coords }
    MySQL.update.await('UPDATE computers_placed SET hostname = ? WHERE id = ?', { r.hostname, id })
    if not track(r) then return nil, 'admin.failed' end
    publish()
    return id
end

---Change what a placed computer is: its name, prop, style, job lock and Business Manager (the
---panel sends all five). A picked one keeps its prop: that is the game's, not ours to swap.
---@param id integer|nil
---@param d table { label, prop, style?, jobs?, boss? }
---@return boolean ok
---@return string|nil why locale key
function placed.update(id, d)
    local r = placed.get(id)
    if not r then return false, 'admin.gone' end
    local label = labelOf(d.label)
    local model = r.world and r.prop or (placed.prop(d.prop) or {}).model
    local style, styleOk = styleOf(d.style)
    local groups, groupsOk = groupsOf(d.jobs)
    local boss, bossOk = bossOf(d.boss)
    if not label or not model or not styleOk or not groupsOk or not bossOk then return false, 'admin.bad_request' end
    -- (who gets the Business Manager is settled as a computer opens: whoever is at it opens it again)
    if boss ~= r.boss then placed.onChanged(r.key, 'err.computer_updated') end

    if label ~= r.label then r.hostname = hostnameOf(label, r.id) end
    r.label, r.prop, r.style, r.groups, r.boss = label, model, style, groups, boss
    MySQL.update.await('UPDATE computers_placed SET label = ?, hostname = ?, prop = ?, style = ?, access = ?, boss = ? WHERE id = ?',
        { r.label, r.hostname, r.prop, r.style, groups and json.encode(groups) or nil, boss == true and ANY_BOSS or boss, r.id })
    apply(r)
    publish()
    return true
end

---Stand a placed computer somewhere else. Whoever is using it is stood up first.
---@param id integer|nil
---@param at table { x, y, z, heading }
---@return boolean ok
---@return string|nil why locale key
function placed.move(id, at)
    local r = placed.get(id)
    if not r then return false, 'admin.gone' end
    local coords = coordsOf(at)
    if not coords or r.world then return false, 'admin.bad_request' end -- (a picked prop is where the game put it)
    placed.onChanged(r.key, 'err.computer_changed')
    r.coords = coords
    MySQL.update.await('UPDATE computers_placed SET x = ?, y = ?, z = ?, heading = ? WHERE id = ?', { coords.x, coords.y, coords.z, coords.w, r.id })
    apply(r)
    publish()
    return true
end

---Take a placed computer away. Its System Logs stay until the retention purge gets to them.
---@param id integer|nil
---@return boolean ok
---@return string|nil why locale key
function placed.remove(id)
    local r = placed.get(id)
    if not r then return false, 'admin.gone' end
    placed.onChanged(r.key, 'err.computer_changed')
    MySQL.query.await('DELETE FROM computers_placed WHERE id = ?', { r.id })
    registry.remove(r.key)
    list[r.id] = nil
    publish()
    return true
end

---Take every placed computer away.
---@return integer count
function placed.clear()
    local ids = {}
    for id in pairs(list) do ids[#ids + 1] = id end -- (remove() edits the table being walked)
    local n = 0
    for _, id in ipairs(ids) do
        if placed.remove(id) then n = n + 1 end
    end
    return n
end

---Clear the published list (resource stop: GlobalState outlives the resource, and clients must
---drop their props at once).
function placed.unpublish()
    GlobalState[STATE_KEY] = {}
end

return placed
