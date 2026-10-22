---@type table sd-computers config root (configs/config.lua).
local config = require 'configs.config'
---@type table Console log helper (shared.log): tagged color-coded prints.
local log = require 'shared.log'
---@type table Target bridge (bridge.client.target): options across ox/qb/qtarget.
local target = require 'bridge.client.target'
---@type table Client computer state (client.computers.state).
local state = require 'client.computers.state'
---@type table Placement gizmo (client.admin.placer): nothing is used while an admin is placing.
local placer = require 'client.admin.placer'
---@type table Prop picker (client.admin.picker): nothing is used while an admin is picking either.
local picker = require 'client.admin.picker'

---@type string GlobalState key the server publishes the placed computers under.
local STATE_KEY = 'sd-computers:placed'
---@type table Target option look (config.Interact.Target).
local T = (config.Interact and config.Interact.Target) or {}
---@type number Metres from a placed computer its prop is spawned at.
local SPAWN_DISTANCE = (config.Admin and config.Admin.SpawnDistance) or 60.0
---@type number Metres from where it was picked the game's prop is looked for.
local PICK_RADIUS = 0.4
---@type integer ms between looks for the game's props of the picked computers around.
local PICK_INTERVAL = 1000

-- Computers made from the admin panel, in the world. A placed one is a local prop (every client
-- spawns its own from the server's list, so nothing syncs); a picked one (`world`) is a prop the
-- game has there already, found again each time it streams in. Either gets the same "Use Computer"
-- option every other computer has. To the server it is a location computer: opening it sends only
-- its id, and reach is measured from the coords the server holds (server/computers/placed.lua).

---@type table Placed-computer module; the table returned at end of file.
local placed = {}

-- Every placed computer this client knows about, keyed by id: { rec, point, obj, near }.
---@type table<integer, table>
local tracked = {}
---@type table<integer, integer> entity handle -> computer id, for the props that are standing.
local entities = {}

---Whether an entity is one of our placed or picked computers. A prop that is also a model computer
---in configs/shared/computers.lua must answer as that one only (client/computers/interact.lua).
---@param entity any
---@return boolean
function placed.isPlaced(entity)
    return type(entity) == 'number' and entities[entity] ~= nil
end

---What a target option of ours is taken off an entity by: ox_target goes by the option's name,
---qb-target and qtarget by its label. (Never by nothing: that takes every resource's options off,
---and a picked prop is the game's, not only ours.)
---@param rec table record
---@return string
local function optionKey(rec)
    return target.system == 'ox_target' and ('sd_computers_' .. rec.key) or (T.label or 'Use Computer')
end

---The "Use Computer" option of a computer: on its prop, or on its box when it has none.
---@param rec table record
---@param obj integer|nil the prop (nil: a box, whose screen is whatever screen prop stands in it)
---@return table option
local function optionOf(rec, obj)
    local c = rec.coords
    return {
        name = 'sd_computers_' .. rec.key,
        label = T.label or 'Use Computer',
        icon = T.icon or 'fas fa-desktop',
        distance = T.distance or 1.8,
        groups = rec.groups, -- ox_target hides the option from everyone else (the server enforces it regardless)
        canInteract = function() return not state.isOpen() and not placer.isActive() and not picker.isActive() end,
        onSelect = function() state.open(rec.key, vec3(c.x, c.y, c.z), false, nil, obj) end,
    }
end

---Make a prop the computer: remember it and give it the option.
---@param entry table tracked entry
---@param obj integer
local function attach(entry, obj)
    entry.obj = obj
    entities[obj] = entry.rec.id
    target.addLocalEntity(obj, { optionOf(entry.rec, obj) })
end

---Give a computer that has no prop (one another resource added) its box, as a computers.lua
---location has one: the option shows while the player looks into it. What takes it away again:
---ox_target goes by the id it gave, qb-target and qtarget by the name.
---@param rec table record
---@return any zone
local function addBox(rec)
    local c, b = rec.coords, rec.box
    local name = 'sd_computers_' .. rec.key
    local id = target.addBoxZone({
        name = name, coords = vec3(c.x, c.y, c.z), size = vec3(b.x, b.y, b.z), rotation = c.w,
        debug = config.Debug, options = { optionOf(rec, nil) },
    })
    return target.system == 'ox_target' and id or name
end

---Stand a placed computer's prop.
---@param entry table tracked entry
local function spawn(entry)
    if entry.obj then return end
    local rec = entry.rec
    local hash = joaat(rec.prop)
    if not IsModelInCdimage(hash) then
        log.error('placed', 'computer %s: model %s does not exist', tostring(rec.key), tostring(rec.prop))
        return
    end
    if not lib.requestModel(hash, 5000) then return end
    local c = rec.coords
    local obj = CreateObjectNoOffset(hash, c.x, c.y, c.z, false, false, false)
    SetModelAsNoLongerNeeded(hash)
    if not DoesEntityExist(obj) then return end
    SetEntityRotation(obj, 0.0, 0.0, c.w, 2, false)
    FreezeEntityPosition(obj, true)
    SetEntityInvincible(obj, true)
    attach(entry, obj)
end

---Let go of a computer's prop: a placed one is deleted, a picked one is the game's and stays.
---@param entry table tracked entry
local function despawn(entry)
    local obj = entry.obj
    if not obj then return end
    entry.obj = nil
    entities[obj] = nil
    target.removeLocalEntity(obj, optionKey(entry.rec))
    if not DoesEntityExist(obj) then return end
    if entry.rec.world then FreezeEntityPosition(obj, false) else DeleteEntity(obj) end
end

---Find a picked computer's prop: the game's own, where it was picked. The game takes its props
---away and brings them back as the player moves about, under a new handle each time, so the one
---held is checked (still there, still that model, still at that spot) and looked for again.
---@param entry table tracked entry of a picked computer
local function find(entry)
    local rec = entry.rec
    local c, hash = rec.coords, joaat(rec.prop)
    local at = vec3(c.x, c.y, c.z)
    local obj = entry.obj
    if obj then
        if DoesEntityExist(obj) and GetEntityModel(obj) == hash and #(GetEntityCoords(obj) - at) <= PICK_RADIUS * 2 then return end
        despawn(entry)
    end
    local found = GetClosestObjectOfType(c.x, c.y, c.z, PICK_RADIUS, hash, false, false, false)
    if found and found ~= 0 and DoesEntityExist(found) and not entities[found] then
        FreezeEntityPosition(found, true) -- (a monitor knocked off its desk would stop being the one picked)
        attach(entry, found)
    end
end

---@param a table<string, integer>|nil job lock
---@param b table<string, integer>|nil job lock
---@return boolean
local function sameGroups(a, b)
    a, b = a or {}, b or {}
    for job, grade in pairs(a) do
        if b[job] ~= grade then return false end
    end
    for job in pairs(b) do
        if a[job] == nil then return false end
    end
    return true
end

---What makes a record a different thing to stand: its prop or box, its spot, or who may use it.
---@param a table record
---@param b table record
---@return boolean
local function differs(a, b)
    local ca, cb = a.coords, b.coords
    local ba, bb = a.box or {}, b.box or {}
    return a.prop ~= b.prop or (a.world == true) ~= (b.world == true) or ca.x ~= cb.x or ca.y ~= cb.y or ca.z ~= cb.z or ca.w ~= cb.w
        or ba.x ~= bb.x or ba.y ~= bb.y or ba.z ~= bb.z or not sameGroups(a.groups, b.groups)
end

---@param id integer|string
local function forget(id)
    local entry = tracked[id]
    if not entry then return end
    despawn(entry)
    if entry.point then entry.point:remove() end
    if entry.zone then target.removeZone(entry.zone) end
    tracked[id] = nil
end

---Reconcile with the server's list (the placed computers, by row id, and the ones other resources
---added, by 'added:<id>').
---@param list table<string, table>|nil GlobalState payload, keyed by stringified computer id
local function sync(list)
    local seen = {}
    for _, rec in pairs(list or {}) do
        seen[rec.id] = true
        local old = tracked[rec.id]
        if old and differs(old.rec, rec) then
            forget(rec.id) -- (changed: stood again as it is now)
        elseif old then
            old.rec.style = rec.style -- (a new look needs no new prop: its screen picks it up)
        end
        if not tracked[rec.id] then
            local entry = { rec = rec }
            if rec.box then
                entry.zone = addBox(rec)
            else
                local point = lib.points.new({ coords = vec3(rec.coords.x, rec.coords.y, rec.coords.z), distance = SPAWN_DISTANCE })
                function point:onEnter()
                    entry.near = true
                    if rec.world then find(entry) else spawn(entry) end
                end
                function point:onExit()
                    entry.near = false
                    despawn(entry)
                end
                entry.point = point
            end
            tracked[rec.id] = entry
        end
    end
    for id in pairs(tracked) do
        if not seen[id] then forget(id) end
    end
end

AddStateBagChangeHandler(STATE_KEY, 'global', function(_, _, value) sync(value) end)
sync(GlobalState[STATE_KEY])

-- The picked computers around: keep hold of the game's prop for each.
CreateThread(function()
    while true do
        for _, entry in pairs(tracked) do
            if entry.near and entry.rec.world then find(entry) end
        end
        Wait(PICK_INTERVAL)
    end
end)

---Every placed or picked computer whose prop is standing, as (entity, record) pairs - for the
---screens drawn on them (client/screens/world.lua).
---@return fun(): integer?, table?
function placed.each()
    local id, entry
    return function()
        repeat id, entry = next(tracked, id) until id == nil or (entry and entry.obj)
        if not entry then return nil end
        return entry.obj, entry.rec
    end
end

---Every computer that is a box rather than a prop (one another resource added with none), as records
---- for the screens: its screen is the screen prop standing in it, as a computers.lua location's is.
---@return fun(): table?
function placed.boxes()
    local id, entry
    return function()
        repeat id, entry = next(tracked, id) until id == nil or (entry and entry.zone)
        if not entry then return nil end
        return entry.rec
    end
end

---A placed or added computer by its id: its record, and its prop while that is standing (OpenComputer).
---@param key string computer id
---@return table|nil rec
---@return integer|nil obj
function placed.byKey(key)
    for _, entry in pairs(tracked) do
        if entry.rec.key == key then return entry.rec, entry.obj end
    end
    return nil
end

---Delete every prop (resource stop).
function placed.cleanupAll()
    local ids = {}
    for id in pairs(tracked) do ids[#ids + 1] = id end
    for _, id in ipairs(ids) do forget(id) end
end

return placed
