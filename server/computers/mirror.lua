---@type table sd-computers config root (configs/config.lua).
local config = require 'configs.config'
---@type table Console log helper (shared.log): tagged color-coded prints.
local log = require 'shared.log'
---@type table Session guard (server.computers.session): who sits at which computer.
local session = require 'server.computers.session'
---@type table Cooldown gate (server.computers.ratelimit).
local ratelimit = require 'server.computers.ratelimit'
---@type table Custom apps registry (server.computers.apps).
local apps = require 'server.computers.apps'

---@type table Screen settings (config.Screens).
local S = config.Screens or {}
---@type table Live-copy settings (config.Screens.Mirror).
local M = S.Mirror or {}

-- The screen on a computer's prop. Three things happen here:
--   1. every computer in use is published (GlobalState), so the clients around it know its screen
--      is on and in which style;
--   2. while players stand near one, the session's NUI records what it draws and this relays the
--      recording to them (client/screens/mirror.lua plays it on the prop);
--   3. where the custom apps' pages and icons are served from is published too: the page a screen
--      plays the recording on loads nothing from anywhere it is not told it may (web/src/screen).
-- The relay never reads a recording: it checks that the sender holds that computer's session, that
-- the batch fits the size and rate caps, and that each watcher really is standing near the
-- computer. Batches are numbered by the sender; the watchers put them back in order.

---@type table Mirror module; the table returned at end of file.
local mirror = {}

---@type string GlobalState key the computers in use are published under.
local STATE_KEY = 'sd-computers:active'
---@type string GlobalState key the custom apps' origins are published under (space-separated).
local HOSTS_KEY = 'sd-computers:appHosts'
---@type boolean Whether screens are drawn at all.
local ENABLED = S.Enabled ~= false
---@type boolean Whether a session is shared with the players around it.
local LIVE = ENABLED and M.Enabled ~= false
---@type number Metres a watcher may stand from the computer: the draw distance plus slack for latency.
local RANGE = (S.Distance or 12.0) + 4.0
---@type integer Most computers one player watches at a time (the client's cap, plus one changing over).
local MAX_WATCHING = (S.MaxLive or 3) + 1
---@type integer Most players one session is shared with.
local MAX_WATCHERS = M.MaxWatchers or 12

---@type integer Bytes: the largest batch relayed (a whole-screen snapshot, compressed, is a few tens of KB).
local MAX_BATCH = 1024 * 1024
---@type integer Bytes a second one session may send, averaged; the bucket below lets a snapshot through in one go.
local RATE = 256 * 1024
---@type integer Bytes: the most a session can have saved up.
local BURST = 2 * 1024 * 1024
local OUT_RATE = 1024 * 1024
local OUT_BURST = 12 * 1024 * 1024
---@type integer Bytes: batches up to this go as ordinary events, larger ones as latent events.
local SMALL = 4 * 1024
---@type integer Bytes a second a latent batch is sent to a watcher at.
local LATENT_BPS = 256 * 1024

---@type table<string, { src: integer, style: string, x: number, y: number, z: number, n: integer }> instance -> the session on it.
local active = {}
---@type table<string, table<integer, boolean>> instance -> the players watching it.
local watchers = {}
---@type table<integer, table<string, boolean>> player -> the instances they watch.
local watching = {}
---@type table<integer, { tokens: number, at: integer }> session holder -> their byte budget.
local budget = {}
local relayed = {}
---@type integer Counts sessions, so a client can tell a new one from the one it was watching.
local serial = 0

---Publish the computers in use.
local function publish()
    local out = {}
    for instance, a in pairs(active) do
        out[instance] = { style = a.style, x = a.x, y = a.y, z = a.z, n = a.n }
    end
    GlobalState[STATE_KEY] = out
end

---Publish where the custom apps' pages and icons come from ('https://cfx-nui-my-res', or the host
---of an http(s) address an app was given).
local function publishHosts()
    local seen, list = {}, {}
    for _, app in ipairs(apps.all()) do
        for _, url in ipairs({ app.ui or '', app.icon or '' }) do
            local host = url:match('^(https?://[^/]+)')
            if host and not seen[host] then
                seen[host] = true
                list[#list + 1] = host
            end
        end
    end
    GlobalState[HOSTS_KEY] = table.concat(list, ' ')
end

---@param t table|nil
---@return integer
local function count(t)
    local n = 0
    for _ in pairs(t or {}) do n = n + 1 end
    return n
end

---Whether a player is standing near a computer in use (their server-side position, never their word).
---@param src integer
---@param a table active entry
---@return boolean
local function near(src, a)
    local ped = GetPlayerPed(src)
    if not ped or ped == 0 then return false end
    return #(GetEntityCoords(ped) - vec3(a.x, a.y, a.z)) <= RANGE
end

---Tell a session's NUI to record (and send a fresh snapshot), or to stop.
---@param a table active entry
---@param on boolean
local function record(a, on)
    TriggerClientEvent('sd-computers:client:mirror:record', a.src, on)
end

---Stop sharing a session with one player.
---@param src integer watcher
---@param instance string
local function drop(src, instance)
    local list = watchers[instance]
    if not list or not list[src] then return end
    list[src] = nil
    if watching[src] then watching[src][instance] = nil end
    if next(list) == nil then
        watchers[instance] = nil
        local a = active[instance]
        if a then record(a, false) end
    end
end

---Take `size` bytes out of a session's budget (false = over it: the batch is not relayed).
---@param src integer
---@param size integer
---@return boolean
local function spend(src, size)
    local now = GetGameTimer()
    local b = budget[src]
    if not b then b = { tokens = BURST, at = now }; budget[src] = b end
    b.tokens = math.min(BURST, b.tokens + (now - b.at) / 1000 * RATE)
    b.at = now
    if b.tokens < size then return false end
    b.tokens = b.tokens - size
    return true
end

local function spendOut(src, size)
    local now = GetGameTimer()
    local b = relayed[src]
    if not b then b = { tokens = OUT_BURST, at = now }; relayed[src] = b end
    b.tokens = math.min(OUT_BURST, b.tokens + (now - b.at) / 1000 * OUT_RATE)
    b.at = now
    if b.tokens < size then return false end
    b.tokens = b.tokens - size
    return true
end

session.onOpen(function(src, s)
    if not ENABLED then return end
    serial = serial + 1
    active[s.instance] = { src = src, style = s.style, x = s.coords.x, y = s.coords.y, z = s.coords.z, n = serial }
    publish()
end)

session.onClose(function(src, s)
    local a = active[s.instance]
    if not a or a.src ~= src then return end
    active[s.instance] = nil
    budget[src] = nil
    relayed[src] = nil
    for w in pairs(watchers[s.instance] or {}) do
        if watching[w] then watching[w][s.instance] = nil end
    end
    watchers[s.instance] = nil
    publish() -- (the watchers' clients see it go and put the lock face back)
end)

---A player near a computer in use asks to see its screen - or, already watching, asks for a fresh
---snapshot because a batch never reached them.
---@param instance string
RegisterNetEvent('sd-computers:server:mirror:watch', function(instance)
    local src = source
    if not LIVE or type(instance) ~= 'string' then return end
    local a = active[instance]
    if not a then return end
    if a.src == src and not M.Self then return end
    if not ratelimit.take(src, 'mirror:' .. instance, 2) then return end
    if not near(src, a) then return end

    local mine = watching[src]
    if not mine then mine = {}; watching[src] = mine end
    if not mine[instance] then
        if count(mine) >= MAX_WATCHING or count(watchers[instance]) >= MAX_WATCHERS then return end
        mine[instance] = true
        local list = watchers[instance]
        if not list then list = {}; watchers[instance] = list end
        list[src] = true
        log.debug('mirror', 'src=%s watches %s', src, instance)
    end
    record(a, true)
end)

---A player walked away from a screen they were watching.
---@param instance string
RegisterNetEvent('sd-computers:server:mirror:unwatch', function(instance)
    if type(instance) ~= 'string' then return end
    drop(source, instance)
end)

---The session's NUI recorded something: pass it on to whoever is watching that computer.
---@param seq integer the batch's place in the recording
---@param full boolean true when the batch starts with a whole-screen snapshot
---@param blob string the batch, exactly as the NUI packed it
RegisterNetEvent('sd-computers:server:mirror:batch', function(seq, full, blob)
    local src = source
    local s = session.get(src)
    if not s then return end
    local a = active[s.instance]
    if not a or a.src ~= src then return end
    local list = watchers[s.instance]
    if not list then return end
    local n = type(seq) == 'number' and math.tointeger(seq) or nil
    if not n or type(blob) ~= 'string' then return end
    local size = #blob
    if size == 0 or size > MAX_BATCH or not spend(src, size) or not spendOut(src, size * count(list)) then return end

    full = full == true
    for w in pairs(list) do
        if size > SMALL then
            TriggerLatentClientEvent('sd-computers:client:mirror:batch', w, LATENT_BPS, s.instance, n, full, blob)
        else
            TriggerClientEvent('sd-computers:client:mirror:batch', w, s.instance, n, full, blob)
        end
    end
end)

AddEventHandler('playerDropped', function()
    local src = source
    for instance in pairs(watching[src] or {}) do drop(src, instance) end
    watching[src] = nil
    ratelimit.clear(src) -- (one cooldown per computer watched adds up over a long session)
end)

-- A watcher is expected to say when they leave. One who does not (or who lies about where they
-- stand to read a screen across the map) is dropped here.
CreateThread(function()
    while true do
        Wait(3000)
        for instance, list in pairs(watchers) do
            local a = active[instance]
            local gone = {}
            for w in pairs(list) do
                if not a or not near(w, a) then gone[#gone + 1] = w end
            end
            for _, w in ipairs(gone) do drop(w, instance) end
        end
    end
end)

---Clear the published list (resource stop: GlobalState outlives the resource, and clients must put
---the lock faces back at once).
function mirror.unpublish()
    GlobalState[STATE_KEY] = {}
    GlobalState[HOSTS_KEY] = ''
end

if ENABLED then
    publish()
    publishHosts()
    apps.onChanged(publishHosts)
end

return mirror
