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
require 'server.admin.panel' -- the /computeradmin panel's verbs: list, place, change, move, remove

---Retention purge at boot, then every 6 hours.
CreateThread(function()
    while true do
        logs.purge()
        Wait(6 * 60 * 60 * 1000)
    end
end)

---Export: every computer (id, label, location or model) - the configured ones and the ones made
---from the admin panel (`placed = true`, with the prop they are; `world = true` when that prop is
---one the game already had there) - for other resources that want to write logs to them or list them.
---One of the config's that the admin panel took away is not listed.
---@return table[] { id, label, hostname, coords?, model?, placed?, prop?, world? }
exports('GetComputers', function()
    local out = {}
    for _, def in ipairs(registry.all()) do
        if not removed.is(def.id) then
            out[#out + 1] = { id = def.id, label = def.label, hostname = def.hostname, coords = def.coords, model = def.model, placed = def.placed ~= nil or nil, prop = def.prop, world = def.world }
        end
    end
    return out
end)

local placedCount = 0
for _ in pairs(placed.all()) do placedCount = placedCount + 1 end
local total = #registry.all() - removed.count() -- (the ones the admin panel took away are not computers)
log.info(nil, 'ready - %d computers (%d configured, %d placed)', total, total - placedCount, placedCount)

-- Every export is in place now. Resources that put custom apps on the desktop register on this
-- (server side): onResourceStart('sd-computers') comes too early, while the database is still
-- being set up above and the exports below it do not exist yet. Fired again on every restart.
TriggerEvent('sd-computers:ready')
