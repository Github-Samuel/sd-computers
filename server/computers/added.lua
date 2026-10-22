---@type table Console log helper (shared.log): tagged color-coded prints.
local log = require 'shared.log'
---@type table Computer definitions (server.computers.registry).
local registry = require 'server.computers.registry'
---@type table Computers placed from the admin panel (server.computers.placed): what a record may
---hold, and the list the clients are sent.
local placed = require 'server.computers.placed'
---@type table Session module (server.computers.session): whoever is at a computer that goes.
local session = require 'server.computers.session'

-- Computers other resources add with the AddComputer export: a desk in a player's house, a laptop a
-- heist leaves on a table. They are kept in memory only. The resource that added one owns it: only
-- it can change or remove it, and its computers go when it stops - so it adds them as it starts, and
-- again on sd-computers:ready (a restart of sd-computers forgets them). Like a placed computer each
-- is a LOCATION computer in the registry, so opening one goes through every check a computers.lua
-- entry does, and the clients get them in the placed computers' list (server/computers/placed.lua):
-- a prop stood there, the game's own prop there (`world`), or a target box where there is no prop.
-- The PIN and the owners list stay on the server.

---@type table Added-computer module; the table returned at end of file.
local added = {}

---@class AddedComputer
---@field id string registry id: what the resource named it
---@field resource string the resource that added it
---@field input table what it was added with (UpdateComputer lays changes over it)
---@field label string
---@field hostname string
---@field coords { x: number, y: number, z: number, w: number }
---@field prop string|nil model stood there (or the game's own there, with `world`); nil = a target box
---@field world boolean
---@field box { x: number, y: number, z: number }|nil the target box's size, when there is no prop
---@field style string|nil Desktop.Styles key; nil = Desktop.DefaultStyle
---@field groups table<string, integer>|nil job/gang lock
---@field owners table<string, boolean>|nil the citizenids that may use it; nil = no list
---@field pin string|nil
---@field boss string|boolean|nil
---@field apps string[]|nil
---@field def table the registry entry (the same table for its whole life: open sessions hold it)

---@type table<string, AddedComputer>
local list = {}

---@type string[] The computers.lua switches a resource can turn off (`false`) for its computer.
local SWITCHES = { 'board', 'cameras', 'photos', 'phone' }

-- ── What a computer may be ────────────────────────────────────────────────────────────────

---Where a resource put its computer, as stored coords (nil when it is not a position).
---@param at any vector3 | vector4 | { x, y, z, w? }
---@param heading any used when `at` has no heading of its own
---@return table|nil coords { x, y, z, w }
local function coordsOf(at, heading)
    local t = type(at)
    if t == 'vector3' then return placed.coordsOf({ x = at.x, y = at.y, z = at.z, w = heading }) end
    if t == 'vector4' then return placed.coordsOf({ x = at.x, y = at.y, z = at.z, w = at.w }) end
    if t ~= 'table' then return nil end
    return placed.coordsOf({ x = at.x, y = at.y, z = at.z, w = at.w or at.heading or heading })
end

---A job lock as computers.lua has it ({ police = 0 }), from that, one job name or a list of them
---(any grade). `false` = none.
---@param raw any
---@return table<string, integer>|nil groups
---@return boolean ok
local function groupsOf(raw)
    if raw == false then return nil, true end
    if type(raw) == 'string' then raw = { [raw] = 0 } end
    if type(raw) == 'table' and raw[1] ~= nil then
        local map = {}
        for _, name in ipairs(raw) do
            if type(name) ~= 'string' then return nil, false end
            map[name] = 0
        end
        raw = map
    end
    return placed.groupsOf(raw)
end

---The citizenids that may use it, as a set. An empty list lets nobody in. `false` = no list.
---@param raw any
---@return table<string, boolean>|nil owners
---@return boolean ok
local function ownersOf(raw)
    if raw == nil or raw == false then return nil, true end
    if type(raw) == 'string' then raw = { raw } end
    if type(raw) ~= 'table' then return nil, false end
    local out, n = {}, 0
    for _, cid in ipairs(raw) do
        if type(cid) ~= 'string' or cid == '' or #cid > 64 then return nil, false end
        out[cid] = true
        n = n + 1
        if n > 128 then return nil, false end
    end
    return out, true
end

---A PIN the lock screen can take: letters and digits, 16 at most. `false` = none.
---@param raw any
---@return string|nil pin
---@return boolean ok
local function pinOf(raw)
    if raw == nil or raw == false then return nil, true end
    local pin = type(raw) == 'number' and tostring(math.tointeger(raw) or '') or raw
    if type(pin) ~= 'string' or not pin:match('^%w+$') or #pin > 16 then return nil, false end
    return pin, true
end

---An app list (computers.lua `apps`): ids, which the registry filters to the apps there are. `false` = the default ones.
---@param raw any
---@return string[]|nil apps
---@return boolean ok
local function appsOf(raw)
    if raw == nil or raw == false then return nil, true end
    if type(raw) ~= 'table' then return nil, false end
    local out = {}
    for _, id in ipairs(raw) do
        if type(id) ~= 'string' then return nil, false end
        out[#out + 1] = id
    end
    return out, true
end

---A target box's size (no prop): a vector3 or { x, y, z }, each side 0.1-5 metres.
---@param raw any
---@return table|nil size
local function boxOf(raw)
    if raw == nil then return { x = 0.8, y = 0.8, z = 0.8 } end
    if type(raw) ~= 'vector3' and type(raw) ~= 'table' then return nil end
    local x, y, z = tonumber(raw.x), tonumber(raw.y), tonumber(raw.z)
    if not x or not y or not z then return nil end
    local function side(v) return math.min(5.0, math.max(0.1, v + 0.0)) end
    return { x = side(x), y = side(y), z = side(z) }
end

---The machine name CMD and the logs show: the one given, else the label as a hostname.
---@param raw any
---@param label string
---@return string
local function hostnameOf(raw, label)
    local base = type(raw) == 'string' and raw or label
    local slug = base:upper():gsub('[^%w%-]+', '-'):gsub('^%-+', ''):gsub('%-+$', ''):sub(1, 24):gsub('%-+$', '')
    return slug ~= '' and slug or 'PC'
end

---A computer as AddComputer was handed it, checked and cut down to what it can be.
---@param d table
---@return AddedComputer|nil r
---@return string|nil err what is wrong with it, for the resource's developer
local function build(d)
    local id = d.id
    if type(id) ~= 'string' or not id:match('^[%w_%-]+$') or #id > 64 then return nil, 'id must be 1-64 letters, digits, _ or -' end
    if id:sub(1, 7) == 'placed_' then return nil, 'ids starting with placed_ are the admin panel\'s' end
    local label = placed.labelOf(d.label)
    if not label then return nil, 'label must be a non-empty string' end
    local coords = coordsOf(d.coords, d.heading)
    if not coords then return nil, 'coords must be a vector3, a vector4 or { x, y, z, w? }' end

    local prop = d.prop
    if prop == false then prop = nil end
    if prop ~= nil and (type(prop) ~= 'string' or not prop:match('^[%w_%-]+$') or #prop > 64) then return nil, 'prop must be a model name' end
    local world = d.world == true
    if world and not prop then return nil, 'world = true needs the prop that stands there' end
    local box = not prop and boxOf(d.size) or nil
    if not prop and not box then return nil, 'size must be a vector3 or { x, y, z }' end

    local style, styleOk = placed.styleOf(d.style)
    if not styleOk then return nil, ('no style %s in Desktop.Styles'):format(tostring(d.style)) end
    local groups, groupsOk = groupsOf(d.groups)
    if not groupsOk then return nil, 'groups must be { job = grade }, a job name or a list of them' end
    local owners, ownersOk = ownersOf(d.owners)
    if not ownersOk then return nil, 'owners must be a list of citizenids' end
    local pin, pinOk = pinOf(d.pin)
    if not pinOk then return nil, 'pin must be letters and digits, 16 at most' end
    local boss, bossOk = placed.bossOf(d.boss)
    if not bossOk then return nil, 'boss must be a job name or true' end
    local apps, appsOk = appsOf(d.apps)
    if not appsOk then return nil, 'apps must be a list of app ids' end

    local r = {
        id = id, label = label, hostname = hostnameOf(d.hostname, label), coords = coords,
        prop = prop, world = world, box = box, style = style, groups = groups, owners = owners, pin = pin, boss = boss, apps = apps,
    }
    for _, key in ipairs(SWITCHES) do
        if d[key] == false then r[key] = false end
    end
    return r
end

-- ── Registry + state ──────────────────────────────────────────────────────────────────────

---Write a record's fields into its registry entry (in place: sessions that are open keep reading
---the same table, so a changed job lock or owners list applies to them at once).
---@param r AddedComputer
local function apply(r)
    local def = r.def
    def.id, def.added = r.id, r.resource
    def.label, def.hostname = r.label, r.hostname
    def.coords, def.heading = vec3(r.coords.x, r.coords.y, r.coords.z), r.coords.w
    def.prop, def.world = r.prop, r.world or nil
    def.style, def.groups, def.owners, def.pin, def.boss, def.apps = r.style, r.groups, r.owners, r.pin, r.boss, r.apps
    for _, key in ipairs(SWITCHES) do def[key] = r[key] end
end

---Whether a change means whoever is at it has to open it again: it is somewhere else, it is another
---prop, or the desktop it gave them has other apps on it now.
---@param a AddedComputer
---@param b AddedComputer
---@return boolean
local function resets(a, b)
    local ca, cb = a.coords, b.coords
    if ca.x ~= cb.x or ca.y ~= cb.y or ca.z ~= cb.z or a.prop ~= b.prop or a.world ~= b.world or a.boss ~= b.boss then return true end
    if table.concat(a.apps or {}, ',') ~= table.concat(b.apps or {}, ',') or (a.apps == nil) ~= (b.apps == nil) then return true end
    for _, key in ipairs(SWITCHES) do
        if a[key] ~= b[key] then return true end
    end
    return false
end

---Take a computer away: whoever is at it is stood up.
---@param r AddedComputer
local function drop(r)
    session.closeComputer(r.id, 'err.computer_gone')
    registry.remove(r.id)
    list[r.id] = nil
end

---The added computers as the clients get them, beside the placed ones (placed.extra). The PIN and
---the owners list are not in it.
---@return table<string, table>
function added.published()
    local out = {}
    for id, r in pairs(list) do
        local key = 'added:' .. id
        out[key] = { id = key, key = id, prop = r.prop, world = r.world or nil, box = r.box, style = r.style, coords = r.coords, groups = r.groups }
    end
    return out
end
placed.extra = added.published

-- ── Changes (each returns ok, then why not) ───────────────────────────────────────────────

---Add a computer for a resource, or replace the one it added under that id.
---@param d any
---@param resource string the resource adding it
---@return boolean ok
---@return string|nil err
function added.add(d, resource)
    if type(d) ~= 'table' then return false, 'AddComputer takes a table' end
    local r, err = build(d)
    if not r then return false, err end
    r.resource = resource
    r.input = {}
    for k, v in pairs(d) do r.input[k] = v end

    local old = list[r.id]
    if old then
        if old.resource ~= resource then return false, ('%s was added by %s'):format(r.id, old.resource) end
        if resets(old, r) then session.closeComputer(r.id, 'err.computer_reset') end
        r.def = old.def
    else
        if registry.get(r.id) then return false, ('%s is a computer already'):format(r.id) end
        r.def = {}
    end
    apply(r)
    if not old then registry.add(r.def) end
    list[r.id] = r
    placed.publish()
    return true
end

---Change some of what a computer was added with. `false` clears an optional field.
---@param id any
---@param changes any
---@param resource string the resource asking
---@return boolean ok
---@return string|nil err
function added.update(id, changes, resource)
    local r = list[id]
    if not r then return false, ('no computer %s was added'):format(tostring(id)) end
    if r.resource ~= resource then return false, ('%s was added by %s'):format(r.id, r.resource) end
    if type(changes) ~= 'table' then return false, 'UpdateComputer takes a table of changes' end
    local d = {}
    for k, v in pairs(r.input) do d[k] = v end
    for k, v in pairs(changes) do d[k] = v end
    d.id = r.id
    return added.add(d, resource)
end

---Take away a computer a resource added.
---@param id any
---@param resource string the resource asking
---@return boolean ok
---@return string|nil err
function added.remove(id, resource)
    local r = list[id]
    if not r then return false, ('no computer %s was added'):format(tostring(id)) end
    if r.resource ~= resource then return false, ('%s was added by %s'):format(r.id, r.resource) end
    drop(r)
    placed.publish()
    return true
end

---Every computer of a resource that stopped goes with it.
AddEventHandler('onResourceStop', function(resource)
    if resource == GetCurrentResourceName() then return end
    local n = 0
    for _, r in pairs(list) do
        if r.resource == resource then
            drop(r)
            n = n + 1
        end
    end
    if n > 0 then
        placed.publish()
        log.debug('added', 'removed the %d computer(s) of %s (stopped)', n, resource)
    end
end)

-- ── Exports ───────────────────────────────────────────────────────────────────────────────

---The resource calling an export (sd-computers itself, from its own code or the console).
---@return string
local function caller()
    return GetInvokingResource() or GetCurrentResourceName()
end

---Add a computer (or replace the one this resource added under that id). See docs: Server Exports.
---@param d table { id, label, coords, heading?, prop?, world?, size?, style?, groups?, owners?, pin?, boss?, apps?, hostname?, board?, cameras?, photos?, phone? }
---@return boolean ok
---@return string|nil err
exports('AddComputer', function(d)
    local ok, err = added.add(d, caller())
    if not ok then log.warn('added', 'AddComputer from %s refused: %s', caller(), tostring(err)) end
    return ok, err
end)

---Change some of what a computer this resource added was added with.
---@param id string
---@param changes table
---@return boolean ok
---@return string|nil err
exports('UpdateComputer', function(id, changes)
    local ok, err = added.update(id, changes, caller())
    if not ok then log.warn('added', 'UpdateComputer from %s refused: %s', caller(), tostring(err)) end
    return ok, err
end)

---Take away a computer this resource added.
---@param id string
---@return boolean ok
---@return string|nil err
exports('RemoveComputer', function(id)
    return added.remove(id, caller())
end)

return added
