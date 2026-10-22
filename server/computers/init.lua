---@type table Console log helper (shared.log): tagged color-coded prints.
local log = require 'shared.log'
---@type table Profile + log persistence (server.computers.store).
local store = require 'server.computers.store'
---@type table Mail persistence (server.computers.mailstore).
local mailstore = require 'server.computers.mailstore'
---@type table System Logs (server.computers.logs).
local logs = require 'server.computers.logs'
---@type table Computer definitions (server.computers.registry).
local registry = require 'server.computers.registry'
---@type table Computers placed from the admin panel (server.computers.placed).
local placed = require 'server.computers.placed'
---@type table The props that are a computer on their own (server.computers.auto).
local auto = require 'server.computers.auto'
---@type table Props added from the admin panel (server.computers.custom).
local custom = require 'server.computers.custom'
---@type table Screens drawn in the admin panel (server.computers.screens).
local screens = require 'server.computers.screens'
---@type table The config's computers an admin took away in the panel (server.computers.removed).
local removed = require 'server.computers.removed'
---@type table The security cameras (server.computers.cameras): the file's, and the ones put up from the panel.
local cameras = require 'server.computers.cameras'
---@type table The printers stood from the admin panel (server.computers.printers).
local printers = require 'server.computers.printers'

-- Boot order matters only for the schema: every table exists before the first callback can run.
-- The feature modules register their callbacks/exports at require time.
store.ensureSchema()
mailstore.ensureSchema()
placed.ensureSchema()
auto.ensureSchema()
cameras.ensureSchema()
printers.ensureSchema()
custom.load() -- props added from the admin panel: before anything that names a prop
screens.load() -- where the screen is on a prop, as an admin drew it in the panel
removed.load() -- the config's computers the admin panel took away
cameras.load() -- the security cameras put up from the panel, and the config's ones it took away
placed.load() -- before the first open: a placed computer is a registry entry like any other
printers.load() -- the printers stood or picked from the panel
auto.load() -- which props in the world are a computer, as the admin panel left them

-- Files and the Company Board keep a table each. They are apps, so requiring them brings the
-- session in with them: after everything above, which a session opening counts on.
require('server.computers.files').ensureSchema() -- Files: the characters' documents
require('server.computers.board').ensureSchema() -- Company Board: the jobs' announcements
require('server.computers.phone').ensureSchema() -- Phone Link: which machines a character's phone is linked to
require('server.computers.photos').ensureSchema() -- Photos: the characters' own pictures
require('server.computers.printing').ensureSchema() -- Printing: the pages, and what waits in which printer's tray
require('server.computers.printing').load() -- (after the printers: a page whose printer is gone waits nowhere)
require('server.computers.appdata').ensureSchema() -- Custom apps: what they keep per character and per machine

require 'server.computers.session'
require 'server.computers.mirror' -- the screen on a computer's prop: which are in use, and the relay to the players watching
require 'server.computers.shell'
require 'server.computers.mail'
require 'server.computers.boss'
require 'server.computers.hacks'
require 'server.computers.phonelink' -- Phone Link: the code that puts the phone's apps on a machine
require 'server.computers.phoneapps' -- Messages + Notes over the optional sd-phone link (inert without it)
require 'server.computers.photos' -- Photos: the character's pictures, and the phone's gallery beside them over the same link
require 'server.computers.contacts' -- Contacts: the phone's address book, over the same link
require 'server.computers.bank' -- Bank: the character's balance + statement (read-only)
require 'server.computers.browser' -- Browser: the sites of configs/shared/browser.lua
require 'server.computers.web' -- Browser: its live sites, read from sd-phone's public apps over the link
require 'server.computers.appapi' -- Custom apps: what their pages call, and the exports that register them
require 'server.computers.added' -- AddComputer: the computers other resources add, kept while they run
require 'server.admin.panel' -- the /computeradmin panel's verbs: list, place, change, move, remove

---Retention purge at boot, then every 6 hours.
CreateThread(function()
    while true do
        logs.purge()
        Wait(6 * 60 * 60 * 1000)
    end
end)

---@type table Session module (server.computers.session): who sits where, for the exports below.
local session = require 'server.computers.session'

---A computer as the exports describe it.
---@param def table computers.lua entry
---@return table { id, label, hostname, coords?, model?, placed?, prop?, world?, resource? }
local function describe(def)
    return {
        id = def.id, label = def.label, hostname = def.hostname, coords = def.coords, model = def.model,
        placed = def.placed ~= nil or nil, prop = def.prop, world = def.world, resource = def.added,
    }
end

---Export: every computer (id, label, location or model) - the configured ones, the ones made from
---the admin panel (`placed = true`, with the prop they are; `world = true` when that prop is one the
---game already had there) and the ones other resources added (`resource`, the one that added it) -
---for other resources that want to write logs to them or list them. One of the config's that the
---admin panel took away is not listed.
---@return table[] { id, label, hostname, coords?, model?, placed?, prop?, world?, resource? }
exports('GetComputers', function()
    local out = {}
    for _, def in ipairs(registry.all()) do
        if not removed.is(def.id) then out[#out + 1] = describe(def) end
    end
    return out
end)

---Export: one computer, as GetComputers lists it (nil for an unknown id, or one the panel took away).
---@param id string computer id
---@return table|nil
exports('GetComputer', function(id)
    local def = registry.get(id)
    if not def or removed.is(def.id) then return nil end
    return describe(def)
end)

---The open sessions on a computer: its id (for a model computer, every prop of it), or one machine
---('<id>@x,y,z').
---@param id any
---@return integer[] sources
local function sessionsOn(id)
    local out = {}
    for _, h in ipairs(session.holders()) do
        if h.id == id or h.instance == id then out[#out + 1] = h.src end
    end
    return out
end

---Export: who is at a computer right now (signed in, or still at its lock screen).
---@param id string a computer id, or one machine of a model computer ('<id>@x,y,z')
---@return table[] { source, citizenid, name, instance, signedIn }
exports('GetComputerUsers', function(id)
    local out = {}
    for _, src in ipairs(sessionsOn(id)) do
        local s = session.get(src)
        if s then out[#out + 1] = { source = src, citizenid = s.citizenid, name = s.name, instance = s.instance, signedIn = s.signedIn == true } end
    end
    return out
end)

---Export: open a computer for a player, from the server (a laptop item's use, a scripted scene). It
---is asked of their client, as the client export: the server then checks reach, the job lock, the
---owners and the PIN exactly as it does at the desk, so this grants nothing the player could not do.
---@param src integer the player's server id
---@param id string computer id
---@param opts? { coords?: vector3, style?: string } coords = a model computer's prop (default: where the player stands)
---@return boolean sent false for an unknown player or computer
exports('OpenComputer', function(src, id, opts)
    local player = math.tointeger(tonumber(src))
    if not player or not GetPlayerName(player) then return false end
    local def = type(id) == 'string' and registry.get(id)
    if not def or removed.is(def.id) then return false end
    local o = type(opts) == 'table' and opts or {}
    TriggerClientEvent('sd-computers:client:openComputer', player, id, o.coords, { style = o.style })
    return true
end)

---Export: close a player's computer, or everyone's at one computer (a house locked, a player cuffed).
---Each is signed out and logged off as if they shut it down.
---@param target integer|string a player's server id, or a computer id / one machine ('<id>@x,y,z')
---@param message? string shown to them (nothing when left out)
---@return integer closed how many sessions were closed
exports('CloseComputer', function(target, message)
    local text = type(message) == 'string' and message ~= '' and require('shared.text').clip(message, 200) or nil
    local list = {}
    if type(target) == 'number' then
        if session.get(target) then list[1] = target end
    elseif type(target) == 'string' then
        list = sessionsOn(target)
    end
    for _, src in ipairs(list) do
        session.close(src)
        TriggerClientEvent('sd-computers:client:forceClose', src, text)
    end
    return #list
end)

local placedCount = 0
for _ in pairs(placed.all()) do placedCount = placedCount + 1 end
local total = #registry.all() - removed.count() -- (the ones the admin panel took away are not computers)
log.info(nil, 'ready - %d computers (%d configured, %d placed)', total, total - placedCount, placedCount)

-- Every export is in place now. Resources that put custom apps on the desktop register on this
-- (server side): onResourceStart('sd-computers') comes too early, while the database is still
-- being set up above and the exports below it do not exist yet. Fired again on every restart.
TriggerEvent('sd-computers:ready')
