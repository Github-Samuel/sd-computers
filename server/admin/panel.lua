---@type table sd-computers config root (configs/config.lua).
local config = require 'configs.config'
---@type table Console log helper (shared.log): tagged color-coded prints.
local log = require 'shared.log'
---@type table Computer definitions (server.computers.registry).
local registry = require 'server.computers.registry'
---@type table Computers placed from this panel (server.computers.placed).
local placed = require 'server.computers.placed'
---@type table The props that are a computer on their own (server.computers.auto): the Automatic tab.
local auto = require 'server.computers.auto'
---@type table Props added from this panel (server.computers.custom).
local custom = require 'server.computers.custom'
---@type table The prop models known as a computer (shared.props): the config's and the added ones.
local props = require 'shared.props'
---@type table Screens drawn from this panel (server.computers.screens).
local screens = require 'server.computers.screens'
---@type table The config's computers taken away from this panel (server.computers.removed).
local removed = require 'server.computers.removed'
---@type table The security cameras (server.computers.cameras): the Cameras tab.
local cameras = require 'server.computers.cameras'
---@type table The printers (server.computers.printers): the Printers tab.
local printers = require 'server.computers.printers'
---@type table Printing (server.computers.printing): what waits in each printer's tray.
local printing = require 'server.computers.printing'
---@type table Session module (server.computers.session): who sits where.
local session = require 'server.computers.session'
---@type table Job roster adapter (server.computers.employees): the jobs a Business Manager can manage.
local employees = require 'server.computers.employees'
---@type table Player bridge (bridge.server.player): names, for who placed a computer.
local player = require 'bridge.server.player'

---@type table Admin config (config.Admin): command, groups, edit ace, props.
local A = config.Admin

-- The /computeradmin panel's server side, built the way sd-bombs builds its own: every panel
-- action is one lib.callback under sd-computers:server:admin:<verb>; every reply has the same
-- shape - { success, message?, data? } - and every reply carries a fresh snapshot, so the panel
-- re-renders from one source of truth.

-- A computer that moves or goes stands up whoever is sitting at it; so does switching off the
-- props that were one.
placed.onChanged = function(key, reason) session.closeComputer(key, reason) end
auto.onChanged = function(key) session.closeComputer(key, 'err.computer_changed') end
removed.onChanged = function(key) session.closeComputer(key, 'err.computer_changed') end
-- A prop added or taken away here changes what the Automatic tab can tick; one a computer is
-- placed as cannot be taken away.
custom.onChanged = auto.refresh
custom.inUse = placed.usesProp

---May this player open the panel at all?
---@param source integer player server id
---@return boolean
local function canView(source)
    local src = tostring(source)
    return IsPlayerAceAllowed(src, 'command.' .. A.Command) or IsPlayerAceAllowed(src, A.EditAce)
end

---May this player change anything? The edit ace, or every command: txAdmin's standard
---`add_ace group.admin command allow` gives admins that, so they can edit even on a server that
---refuses the edit ace's grant below. A ViewGroup only gets command.<Command>, so it stays view only.
---@param source integer player server id
---@return boolean
local function canEdit(source)
    local src = tostring(source)
    return IsPlayerAceAllowed(src, A.EditAce) or IsPlayerAceAllowed(src, 'command')
end

---Everything the panel shows, in one table: every computer (placed from here, or from
---configs/shared/computers.lua - those cannot be changed here, only taken away and put back), the
---props and the styles on offer, and the jobs a computer's Business Manager can be for.
---@param source integer player server id
---@return table snapshot
local function snapshot(source)
    -- Who is sitting where: by computer id (a model computer can have several users, one per prop).
    local users = {}
    for _, h in ipairs(session.holders()) do
        users[h.id] = users[h.id] or {}
        users[h.id][#users[h.id] + 1] = h.name
    end

    local computers = {}
    for index, def in ipairs(registry.all()) do
        local row = {
            key = def.id, order = index, label = def.label or def.id, hostname = def.hostname or tostring(def.id):upper(),
            style = registry.style(def), styleSet = registry.styleSet(def), groups = def.groups, users = users[def.id] or {},
            boss = def.boss == true and '*' or def.boss or nil, pin = registry.pin(def) ~= nil,
        }
        if def.placed then
            local r = placed.get(def.placed)
            row.source, row.id, row.prop = r.world and 'world' or 'placed', def.placed, def.prop
            row.x, row.y, row.z, row.heading = r.coords.x, r.coords.y, r.coords.z, r.coords.w
        elseif def.added then
            -- (added by another resource with the AddComputer export: that resource's to change, not the panel's)
            row.source, row.resource, row.prop = 'script', def.added, def.prop
            row.x, row.y, row.z, row.heading = def.coords.x, def.coords.y, def.coords.z, def.heading or 0.0
        elseif def.coords then
            row.source = 'config'
            row.removed = removed.is(def.id) or nil -- (taken away here: still in the file, not a computer)
            row.x, row.y, row.z, row.heading = def.coords.x, def.coords.y, def.coords.z, def.rotation or 0.0
        else
            row.source = 'model'
            row.models = auto.models(def)
            row.off = #auto.active(def) == 0 -- (switched off, or left with no prop)
        end
        computers[#computers + 1] = row
    end

    local D = config.Desktop
    local styles = {}
    for key, s in pairs(D.Styles or {}) do
        local wallpapers = {}
        for _, w in ipairs(s.Wallpapers or {}) do wallpapers[#wallpapers + 1] = w.label or w.id end
        styles[#styles + 1] = {
            key = key, name = s.OsName or key, build = s.OsBuild or '', wallpaper = s.DefaultWallpaper, accent = (s.Accents or {})[1],
            theme = s.DefaultTheme or 'dark', wallpapers = wallpapers, default = key == registry.style({}),
        }
    end
    table.sort(styles, function(a, b) return a.default ~= b.default and a.default or (a.default == b.default and a.name < b.name) end)

    -- Whether a computer can be given the Business Manager at all - and why not, when it cannot.
    local bossOff = (not employees.supported() and 'framework') or (not (config.Boss and config.Boss.Enabled) and 'disabled') or nil

    return {
        canEdit = canEdit(source),
        computers = computers,
        props = props.list(),
        screens = screens.states(),
        cameras = cameras.snapshot(),
        printers = printers.snapshot(printing.waiting, printing.itemReady()),
        auto = auto.snapshot(),
        styles = styles,
        jobs = employees.jobs(),
        boss = { available = bossOff == nil, reason = bossOff },
        defaultStyle = registry.style({}),
        rules = { boot = D.Boot ~= false, reach = (config.Interact and config.Interact.MaxDistance) or 2.5, maxLabel = A.MaxLabel or 48 },
        refreshMs = A.RefreshMs or 5000,
    }
end

---Register one panel verb. View verbs need the panel's view right, everything else the edit ace;
---a handler returns ok (and optionally a message or extra data), and the reply always carries a
---fresh snapshot.
---@param name string the verb
---@param edit boolean whether it changes anything
---@param handler fun(source: integer, data: table): boolean, string|nil, table|nil
local function verb(name, edit, handler)
    lib.callback.register('sd-computers:server:admin:' .. name, function(source, data)
        if not canView(source) or (edit and not canEdit(source)) then
            log.warn('admin', 'player %d was refused admin verb %s', source, name)
            return { success = false, message = locale('admin.no_permission') }
        end
        local ok, message, extra = handler(source, type(data) == 'table' and data or {})
        local reply = { success = ok == true, message = message, data = extra or {} }
        reply.data.snapshot = snapshot(source)
        if edit then log.debug('admin', 'player %d ran %s: %s', source, name, ok and 'ok' or tostring(message)) end
        return reply
    end)
end

verb('snapshot', false, function() return true end)

-- ---- Computers ----------------------------------------------------------------------------

-- d = { x, y, z, heading (from the gizmo), label, prop, style?, jobs?, boss? }; with world = true the spot
-- and the prop are a prop the game already has there, picked rather than placed.
verb('createComputer', true, function(source, d)
    local id, why = placed.create(d, player.getName(source))
    return id ~= nil, why and locale(why), { computerId = id }
end)

verb('updateComputer', true, function(_, d)
    local ok, why = placed.update(tonumber(d.id), d)
    return ok, why and locale(why)
end)

verb('moveComputer', true, function(_, d)
    local ok, why = placed.move(tonumber(d.id), d)
    return ok, why and locale(why)
end)

verb('deleteComputer', true, function(_, d)
    local ok, why = placed.remove(tonumber(d.id))
    return ok, why and locale(why)
end)

-- Every placed computer goes; the ones in configs/shared/computers.lua belong to the config.
verb('deleteAllComputers', true, function()
    return true, nil, { count = placed.clear() }
end)

-- d.key = a location computer's id from configs/shared/computers.lua. The file is not written to:
-- the entry is only not a computer any more (whoever sits at it is stood up), until it is put back.
verb('removeConfigComputer', true, function(_, d)
    local ok, why = removed.set(d.key, true)
    return ok, why and locale(why)
end)

verb('restoreConfigComputer', true, function(_, d)
    local ok, why = removed.set(d.key, false)
    return ok, why and locale(why)
end)

-- ---- Props that are a computer on their own -----------------------------------------------

-- d.enabled: whether any prop in the world is a computer without being placed or picked.
verb('setAuto', true, function(_, d)
    return auto.setEnabled(d.enabled == true)
end)

-- d.key = a model computer's id from configs/shared/computers.lua.
verb('setAutoComputer', true, function(_, d)
    local ok, why = auto.setComputer(d.key, d.enabled == true)
    return ok, why and locale(why)
end)

-- d.model = one of that computer's props (its own, or a spare one from config.Admin.Props).
verb('setAutoModel', true, function(_, d)
    local ok, why = auto.setModel(d.key, d.model, d.enabled == true)
    return ok, why and locale(why)
end)

-- d.style = a Desktop.Styles key, or nil: the style every prop of that computer opens in.
verb('setAutoStyle', true, function(_, d)
    local ok, why = auto.setStyle(d.key, d.style)
    return ok, why and locale(why)
end)

-- d.style = a Desktop.Styles key, or nil: a style of its own for one prop of that computer.
verb('setAutoModelStyle', true, function(_, d)
    local ok, why = auto.setModelStyle(d.key, d.model, d.style)
    return ok, why and locale(why)
end)

-- ---- Props added from the panel -----------------------------------------------------------

-- d = { model, label, kind }: a prop of the server's own, beside the ones in configs/shared/admin.lua.
-- (The client asked the game whether the model exists before sending this; the server cannot.)
verb('addProp', true, function(_, d)
    local ok, why = custom.add(d)
    return ok, why and locale(why)
end)

verb('removeProp', true, function(_, d)
    local ok, why = custom.remove(d.model)
    return ok, why and locale(why)
end)

-- ---- Where the screen is on a prop --------------------------------------------------------

-- d = { model, x, y, z, w, h, tilt, heading }: the rectangle drawn with the screen tool
-- (client/admin/screener.lua), for every prop of that model.
verb('setScreen', true, function(_, d)
    local ok, why = screens.set(d.model, d)
    return ok, why and locale(why)
end)

-- d.model: back to the screen configs/shared/screens.lua has for it (or to none).
verb('resetScreen', true, function(_, d)
    local ok, why = screens.reset(d.model)
    return ok, why and locale(why)
end)

-- ---- Security cameras ---------------------------------------------------------------------

-- d = { x, y, z, pitch, yaw, fov (from the camera tool), label, area?, jobs? }
verb('createCamera', true, function(source, d)
    local id, why = cameras.create(d, player.getName(source))
    return id ~= nil, why and locale(why), { cameraId = id }
end)

-- d = { id, label, area?, jobs? }: what it is called, the heading it is under, who may watch it.
verb('updateCamera', true, function(_, d)
    local ok, why = cameras.update(tonumber(d.id), d)
    return ok, why and locale(why)
end)

-- d = { id, x, y, z, pitch, yaw, fov }: put somewhere else, or aimed again, with the camera tool.
verb('moveCamera', true, function(_, d)
    local ok, why = cameras.move(tonumber(d.id), d)
    return ok, why and locale(why)
end)

verb('deleteCamera', true, function(_, d)
    local ok, why = cameras.remove(tonumber(d.id))
    return ok, why and locale(why)
end)

-- d.key = the id of a camera from configs/shared/cameras.lua. The file is not written to: the
-- camera is only not offered to anyone any more, until it is put back.
verb('removeConfigCamera', true, function(_, d)
    local ok, why = cameras.setRemoved(d.key, true)
    return ok, why and locale(why)
end)

verb('restoreConfigCamera', true, function(_, d)
    local ok, why = cameras.setRemoved(d.key, false)
    return ok, why and locale(why)
end)

-- d.key = a camera id: stand where it hangs, to see what it sees.
verb('teleportCamera', true, function(source, d)
    local cam = cameras.get(d.key)
    local ped = GetPlayerPed(source)
    if not cam or not ped or ped == 0 then return false, locale('admin.gone') end
    SetEntityCoords(ped, cam.x, cam.y, cam.z, false, false, false, false)
    SetEntityHeading(ped, cam.yaw % 360.0)
    return true
end)

-- ---- Printers -----------------------------------------------------------------------------

-- d = { x, y, z, heading (from the gizmo), label, prop }; with world = true the spot and the prop
-- are a prop the game already has there, picked rather than placed.
verb('createPrinter', true, function(source, d)
    local id, why = printers.create(d, player.getName(source))
    return id ~= nil, why and locale(why), { printerId = id }
end)

-- d = { id, label, prop }
verb('updatePrinter', true, function(_, d)
    local ok, why = printers.update(tonumber(d.id), d)
    return ok, why and locale(why)
end)

verb('movePrinter', true, function(_, d)
    local ok, why = printers.move(tonumber(d.id), d)
    return ok, why and locale(why)
end)

-- (what was waiting in its tray goes with it)
verb('deletePrinter', true, function(_, d)
    local ok, why = printers.remove(tonumber(d.id))
    return ok, why and locale(why)
end)

-- d.id = a printer: stand in front of it.
verb('teleportPrinter', true, function(source, d)
    local r = printers.get(tonumber(d.id))
    local ped = GetPlayerPed(source)
    if not r or not ped or ped == 0 then return false, locale('admin.gone') end
    local rad = math.rad(r.coords.w)
    SetEntityCoords(ped, r.coords.x + math.sin(rad) * 1.2, r.coords.y - math.cos(rad) * 1.2, r.coords.z, false, false, false, false)
    SetEntityHeading(ped, r.coords.w)
    return true
end)

-- ---- Getting around -----------------------------------------------------------------------

-- d.key = a computer id (placed, or a location from the config; a model computer is everywhere).
verb('teleport', true, function(source, d)
    local def = registry.get(d.key)
    local ped = GetPlayerPed(source)
    if not def or not def.coords or not ped or ped == 0 then return false, locale('admin.gone') end
    -- Land a step in front of it, looking at it, rather than on the desk (at the desk's height: the
    -- floor under a computer is anywhere from nothing to a metre below it, so the last bit is a drop).
    local heading = def.heading or def.rotation or 0.0
    local r = math.rad(heading)
    SetEntityCoords(ped, def.coords.x + math.sin(r) * 1.2, def.coords.y - math.cos(r) * 1.2, def.coords.z, false, false, false, false)
    SetEntityHeading(ped, heading)
    return true
end)

-- ---- Opening it ---------------------------------------------------------------------------

---Open the admin panel. The ace this command grants (command.<name>) is the panel's view right.
---@param source integer player server id
lib.addCommand(A.Command, { help = 'Open the computers admin panel', restricted = A.Group }, function(source)
    TriggerClientEvent('sd-computers:client:openAdmin', source)
end)

-- Group edits; ViewGroup (optional) may open the panel and look. Granted through ox_lib: a resource
-- running add_ace itself is refused ("Access denied for command add_ace") unless the server gives
-- it that command, and ox_lib is the one resource a standard permissions.cfg already gives it to.
lib.addAce(A.Group, A.EditAce)
if A.ViewGroup then lib.addAce(A.ViewGroup, 'command.' .. A.Command) end

-- A server without ox_lib's lines (add_ace resource.ox_lib command.add_ace allow) refuses those
-- grants with nothing more than "Access denied" in the console, and the panel opened as view only
-- for admins. Say what to add instead.
SetTimeout(1000, function()
    if not IsPrincipalAceAllowed(A.Group, A.EditAce) then
        log.warn('admin', '%s could not be given %s: this server does not let ox_lib run add_ace. Admins allowed every command (txAdmin\'s `add_ace group.admin command allow`) can still edit; for anyone else, add to your server.cfg: add_ace %s %s allow',
            A.Group, A.EditAce, A.Group, A.EditAce)
    end
    if A.ViewGroup and not IsPrincipalAceAllowed(A.ViewGroup, 'command.' .. A.Command) then
        log.warn('admin', '%s could not be given command.%s: this server does not let ox_lib run add_ace. Add to your server.cfg: add_ace %s command.%s allow',
            A.ViewGroup, A.Command, A.ViewGroup, A.Command)
    end
end)
