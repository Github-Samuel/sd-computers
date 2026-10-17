---@type table Console log helper (shared.log): tagged color-coded prints.
local log = require 'shared.log'
---@type table Client computer state (client.computers.state).
local state = require 'client.computers.state'

-- Custom apps on this client: the relay between their server side and the desktop, which of their
-- windows are open, and the client exports a registering resource uses. The app's page talks to
-- its own resource's NUI callbacks itself (fetchNui); nothing it sends passes through here.

---@type string What a custom app's id is prefixed with on the desktop (server/computers/apps.lua).
local PREFIX = 'ext:'

---@type table<string, string> desktop id -> the resource that registered the app, for the open computer.
local owners = {}
---@type table<string, boolean> desktop ids whose windows are open.
local open = {}

---The desktop id for an app id, either way it is given.
---@param id any
---@return string|nil
local function osId(id)
    if type(id) ~= 'string' or id == '' then return nil end
    return id:sub(1, #PREFIX) == PREFIX and id or PREFIX .. id
end

---A window opened or closed: say so to the resources on this client.
---@param id string desktop id
---@param isOpen boolean
---@param computer? table the computer it is on (state.computer() unless given)
local function mark(id, isOpen, computer)
    if (open[id] == true) == isOpen then return end
    open[id] = isOpen or nil
    TriggerEvent(isOpen and 'sd-computers:appOpened' or 'sd-computers:appClosed', id:sub(#PREFIX + 1), computer or state.computer())
end

---Learn the custom apps (and who registered them) from a list of the desktop's apps. An app that
---is not on it any more has its window closed by the desktop: it is closed here too, now, since
---the desktop's word of it would come for an app this file no longer knows.
---@param list table[]|nil payload.computer.apps
local function learn(list)
    owners = {}
    for _, a in ipairs(list or {}) do
        if type(a) == 'table' and type(a.ext) == 'table' then owners[a.id] = a.ext.resource end
    end
    for id in pairs(open) do
        if not owners[id] then mark(id, false) end
    end
end

state.onOpen(function(payload)
    learn(payload and payload.computer and payload.computer.apps)
end)

-- The computer closed: every app on it closed with it.
state.onClose(function(closing)
    for id in pairs(open) do mark(id, false, closing) end
end)

---What the server sends an app's page or its icon: a message, a notification, a badge, a window
---to open or close, or the desktop's new lists of apps.
---@param kind 'message'|'notify'|'badge'|'open'|'close'|'apps'
---@param data table
RegisterNetEvent('sd-computers:client:app', function(kind, data)
    if not state.isOpen() or type(kind) ~= 'string' or type(data) ~= 'table' then return end
    if kind == 'apps' then learn(data.apps) end
    SendNUIMessage({ action = 'computers:app:' .. kind, data = data })
end)

---The desktop says a custom app's window opened or closed (the server hears it through the rpc).
---@param data { app: string, open: boolean }
---@param cb function nui callback
RegisterNUICallback('computers:app:window', function(data, cb)
    local id = type(data) == 'table' and osId(data.app) or nil
    if id and owners[id] then mark(id, data.open == true) end
    cb({ ok = true })
end)

---Push a message to a custom app's page from this client, as sd-phone's export of the same name
---does: `message` = { action, data }, heard by computer.onMessage(action, cb). Only the resource
---that registered the app may.
---@param id string
---@param message { action: string, data?: any }
---@return boolean ok
---@return string|nil err
local function sendMessage(id, message)
    local app = osId(id)
    if not app then return false, 'id must be a non-empty string' end
    if not state.isOpen() then return false, 'no computer is open' end
    local owner = owners[app]
    if not owner then return false, ('%s is not on this desktop'):format(tostring(id)) end
    local caller = GetInvokingResource()
    if caller and caller ~= owner then return false, ('%s belongs to %s'):format(tostring(id), owner) end
    if type(message) ~= 'table' or type(message.action) ~= 'string' then
        return false, 'message must be { action = string, data = any }'
    end
    SendNUIMessage({ action = 'computers:app:message', data = { app = app, action = message.action, data = message.data } })
    return true
end

---Both spellings of an export: this resource's own (PascalCase) and sd-phone's (camelCase).
---@param name string PascalCase
---@param fn function
local function export(name, fn)
    exports(name, fn)
    exports(name:sub(1, 1):lower() .. name:sub(2), fn)
end

export('SendCustomAppMessage', sendMessage)
export('SendAppMessage', function(id, action, data)
    return sendMessage(id, { action = action, data = data })
end)

---Whether a custom app's window is open on this player's desktop.
---@param id string
---@return boolean
export('IsAppOpen', function(id)
    local app = osId(id)
    return app ~= nil and open[app] == true
end)

---The computer this player is using: { id, instance, coords } (nil when none).
---@return table|nil
export('GetCurrentComputer', function()
    return state.computer()
end)

log.debug('apps', 'client relay ready')
