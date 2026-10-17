---@type table sd-computers config root (configs/config.lua).
local config = require 'configs.config'
---@type table Console log helper (shared.log): tagged color-coded prints.
local log = require 'shared.log'
---@type table UTF-8-safe clipping (shared.text).
local text = require 'shared.text'
---@type table RPC registration (server.computers.rpc).
local rpc = require 'server.computers.rpc'
---@type table Session gate and context (server.computers.session).
local session = require 'server.computers.session'
---@type table Custom app registry (server.computers.apps).
local custom = require 'server.computers.apps'
---@type table What custom apps keep (server.computers.appdata).
local appdata = require 'server.computers.appdata'
---@type table System Logs (server.computers.logs): computer.log.
local logs = require 'server.computers.logs'
---@type table Printing (server.computers.printing): computer.print.
local printing = require 'server.computers.printing'

-- Custom apps, as the page and other resources reach them. The page (web/src/apps/ext, with the
-- SDK in web/public/sdk) calls the endpoints below through the one rpc passthrough, so each is
-- behind the session gate: a signed-in player in reach of their computer. On top of that, every
-- one checks that the app is on that player's desktop there - an app's own endpoints only ever run
-- for a player who has it open in front of them. The exports at the end are for the resources
-- that register apps.

---@type table Custom apps config (configs/shared/apps.lua).
local A = config.Apps or {}
---@type integer computer.callServer calls one player's app may make a second.
local CALLS = math.max(1, math.floor(tonumber(A.CallsPerSecond) or 15))
---@type integer computer.log lines one player may write a minute.
local LOG_LINES = math.max(1, math.floor(tonumber(A.LogsPerMinute) or 20))
---@type integer Storage writes one player's app may make in STORAGE_MS.
local STORAGE_WRITES = 20
local STORAGE_MS = 5000

---@type table<string, boolean> Levels computer.log may write at.
local LOG_LEVELS = { information = true, warning = true, error = true }
---@type integer Longest computer.log details (the JSON of `data`) kept with a line; longer ones are dropped.
local LOG_DATA = 2048

---@type table<integer, table<string, { at: integer, n: integer }>> src -> key -> the window it is counting in.
local counters = {}

---Count one more of something a player does, and say whether it is still within `max` per `ms`.
---@param src integer
---@param key string
---@param max integer
---@param ms integer
---@return boolean
local function within(src, key, max, ms)
    local now = GetGameTimer()
    local mine = counters[src]
    if not mine then
        mine = {}
        counters[src] = mine
    end
    local c = mine[key]
    if not c or now - c.at >= ms then
        mine[key] = { at = now, n = 1 }
        return true
    end
    c.n = c.n + 1
    return c.n <= max
end

AddEventHandler('playerDropped', function()
    counters[source] = nil
end)

---The app a payload names, when it is on this session's desktop.
---@param s ComputerSession
---@param id any
---@return CustomApp|nil
local function installed(s, id)
    local app = custom.get(id)
    if app and s.apps[app.osId] then return app end
    return nil
end

---What an app's code is handed for this player at this session: session.contextOf plus which app it is.
---@param src integer
---@param s ComputerSession
---@param app CustomApp
---@return table
local function contextOf(src, s, app)
    local ctx = session.contextOf(src, s)
    ctx.app = app.id
    return ctx
end

---Call one of an app's functions, keeping an error in it out of the caller's way.
---@param app CustomApp
---@param what string for the console line
---@param fn function
---@param ... any
---@return boolean ok
---@return any ... what it returned
local function run(app, what, fn, ...)
    local res = table.pack(pcall(fn, ...))
    if not res[1] then
        -- (an error inside another resource's function is printed in that resource's console; only
        -- that it failed comes back here)
        local why = res[2] ~= nil and tostring(res[2]) or ('see the error from ' .. app.resource .. ' above')
        log.error('apps', '%s %s failed: %s', app.id, what, why)
        return false
    end
    return true, table.unpack(res, 2, res.n)
end

---Run an app's onOpen / onClose for a player, once per change: a window said to open twice (or to
---close twice) runs nothing more.
---@param src integer
---@param s ComputerSession
---@param app CustomApp
---@param open boolean
local function lifecycle(src, s, app, open)
    s.openApps = s.openApps or {}
    if (s.openApps[app.osId] == true) == open then return end
    s.openApps[app.osId] = open or nil
    local hook = open and app.onOpen or app.onClose
    if hook then run(app, open and 'onOpen' or 'onClose', hook, src, contextOf(src, s, app)) end
end

---Close what a session has open: each app's onClose (an app taken away meanwhile has none left to
---run), and nothing counted as open any more.
---@param src integer
---@param s ComputerSession
local function closeAll(src, s)
    for osId in pairs(s.openApps or {}) do
        local app = custom.get(osId)
        if app and app.onClose then run(app, 'onClose', app.onClose, src, contextOf(src, s, app)) end
    end
    s.openApps = nil
end

-- Locking (Start > Lock, signing out) and closing the computer take the desktop away, and every
-- page on it. This runs while the session is still signed in, so each onClose gets the whole
-- context; windows still there when the player signs in again open afresh, with their onOpen.
session.onLock(closeAll)
-- (a session that ends unsigned has nothing open: this is the backstop)
session.onClose(closeAll)

-- An app that left a session's desktop (a gate it no longer clears, its resource stopped) closes
-- its window with it.
session.onCustomApps(function(src, s)
    for osId in pairs(s.openApps or {}) do
        if not s.apps[osId] then
            s.openApps[osId] = nil
            local app = custom.get(osId)
            if app and app.onClose then run(app, 'onClose', app.onClose, src, contextOf(src, s, app)) end
        end
    end
end)

-- ── What the page calls ────────────────────────────────────────────────────────────────────

---computer.callServer(endpoint, data): one of the app's own endpoints, for this player. An endpoint
---answers with its data, or with false and a message for the page (not nil and a message: values
---coming back from another resource's function lose a nil in front, and the message with it).
---@param p { app: string, endpoint: string, data?: any }
rpc.register('app:call', nil, function(src, s, p)
    local app = installed(s, p.app)
    if not app then return rpc.fail('err.app_missing') end
    local fn = type(p.endpoint) == 'string' and app.endpoints[p.endpoint] or nil
    if not fn then return rpc.fail('apps.no_endpoint', tostring(p.endpoint)) end
    if not within(src, 'call:' .. app.id, CALLS, 1000) then return rpc.fail('err.slow_down') end

    local ok, data, err = run(app, ('endpoint %s'):format(p.endpoint), fn, src, p.data, contextOf(src, s, app))
    if not ok then return rpc.fail('err.internal') end
    if (data == nil or data == false) and type(err) == 'string' then return { ok = false, error = text.clip(err, 300) } end
    return rpc.ok(data)
end)

---The app's window opened or closed: its onOpen / onClose run.
---@param p { app: string, open: boolean }
rpc.register('app:window', nil, function(src, s, p)
    local app = installed(s, p.app)
    if not app then return rpc.fail('err.app_missing') end
    if not within(src, 'window:' .. app.id, 8, 1000) then return rpc.fail('err.slow_down') end
    lifecycle(src, s, app, p.open == true)
    return rpc.ok()
end)

---computer.storage: get / set / keys / clear, for this character or this machine.
---@param p { app: string, op: string, scope?: string, key?: string, value?: string }
rpc.register('app:storage', nil, function(src, s, p)
    local app = installed(s, p.app)
    if not app then return rpc.fail('err.app_missing') end
    local owner = appdata.owner(p.scope, s)
    if not owner then return rpc.fail('err.invalid') end

    if p.op == 'keys' or p.op == 'get' then
        if not within(src, 'storage-read:' .. app.id, 60, STORAGE_MS) then return rpc.fail('err.slow_down') end
    end
    if p.op == 'keys' then return rpc.ok({ keys = appdata.keys(app.id, owner), limits = appdata.limits() }) end
    if p.op == 'get' then
        if not appdata.validKey(p.key) then return rpc.fail('err.invalid') end
        return rpc.ok({ value = appdata.get(app.id, owner, p.key) })
    end

    if not within(src, 'storage:' .. app.id, STORAGE_WRITES, STORAGE_MS) then return rpc.fail('err.slow_down') end
    if p.op == 'clear' then
        appdata.clear(app.id, owner)
        return rpc.ok()
    end
    if p.op == 'set' then
        if not appdata.validKey(p.key) then return rpc.fail('err.invalid') end
        if p.value ~= nil and type(p.value) ~= 'string' then return rpc.fail('err.invalid') end
        local ok, why = appdata.set(app.id, owner, p.key, p.value)
        if not ok then return rpc.fail(why) end
        return rpc.ok()
    end
    return rpc.fail('err.invalid')
end)

---computer.log: one line in this computer's Event Viewer, under the app's name.
---@param p { app: string, message: string, level?: string, data?: table }
rpc.register('app:log', nil, function(src, s, p)
    local app = installed(s, p.app)
    if not app then return rpc.fail('err.app_missing') end
    if type(p.message) ~= 'string' or p.message == '' then return rpc.fail('err.invalid') end
    if not within(src, 'log', LOG_LINES, 60000) then return rpc.fail('err.slow_down') end

    -- (the details are the page's to write, and shown to everyone who opens this Event Viewer: kept small)
    local data = type(p.data) == 'table' and p.data or nil
    if data and #json.encode(data) > LOG_DATA then data = nil end

    logs.write(s.instance, {
        level = LOG_LEVELS[p.level] and p.level or 'information', source = text.clip(app.label, 32),
        eventId = logs.EVENT.EXTERNAL, message = p.message, data = data,
    }, session.actor(s))
    return rpc.ok()
end)

---computer.setBadge: the count on the app's icon, kept for this player.
---@param p { app: string, count: number }
rpc.register('app:badge', nil, function(src, s, p)
    local app = installed(s, p.app)
    if not app then return rpc.fail('err.app_missing') end
    return rpc.ok({ count = custom.setBadge(src, app, p.count) })
end)

-- computer.print: the app's own page (its `print` function builds it from what the app's server
-- knows, as the OS's own apps do), or, from an app with none, a plain typed page of what was sent.
printing.source('app', nil, function(src, s, d)
    local app = installed(s, d.app)
    if not app then return nil, locale('err.app_missing') end
    if app.print then
        local ok, page, why = run(app, 'print', app.print, src, d.data, contextOf(src, s, app))
        if not ok then return nil, locale('err.internal') end
        if type(page) ~= 'table' then return nil, type(why) == 'string' and why or nil end
        -- (the paper it is on: one of the OS's own kinds when the page names one, else plain stock)
        if type(page.kind) ~= 'string' then page.kind = 'custom' end
        return page
    end
    if type(d.text) ~= 'string' then return nil, locale('apps.no_print') end
    return { kind = 'text', title = text.clip(type(d.title) == 'string' and d.title or app.label, 120), body = d.text }
end)

-- ── Exports, for the resources that register apps ─────────────────────────────────────────

---Every player whose signed-in session has a custom app installed (`open` = only those with
---its window open).
---@param app CustomApp
---@param open boolean
---@return integer[]
local function users(app, open)
    local out = {}
    for src, s in session.active() do
        if s.apps[app.osId] and (not open or (s.openApps and s.openApps[app.osId])) then out[#out + 1] = src end
    end
    return out
end

---The players an export is aimed at: one server id, or -1 for every player with the app open
---(`open`) or installed.
---@param target any
---@param app CustomApp
---@param open boolean
---@return integer[]
local function targets(target, app, open)
    if target == -1 then return users(app, open) end
    local src = math.tointeger(tonumber(target))
    if not src then return {} end
    local s = session.get(src)
    if not s or not s.signedIn or not s.apps[app.osId] then return {} end
    return { src }
end

---The app an export names, when the calling resource registered it.
---@param id any
---@return CustomApp|nil app
---@return string|nil err
local function owned(id)
    local app = custom.get(id)
    if not app then return nil, ('no custom app %s'):format(tostring(id)) end
    local caller = GetInvokingResource()
    if caller and caller ~= app.resource then return nil, ('%s belongs to %s'):format(app.id, app.resource) end
    return app
end

---Send the client of each target one of the app events client/computers/apps.lua relays.
---@param list integer[]
---@param kind string
---@param data table
local function send(list, kind, data)
    for _, src in ipairs(list) do TriggerClientEvent('sd-computers:client:app', src, kind, data) end
end

---Both spellings of an export: this resource's own (PascalCase) and sd-phone's (camelCase).
---@param name string PascalCase
---@param fn function
local function export(name, fn)
    exports(name, fn)
    exports(name:sub(1, 1):lower() .. name:sub(2), fn)
end

---Register a custom app (or replace the one this resource registered under that id).
---@param def table see docs: id, label, ui, icon, size, groups, endpoints, onOpen ...
---@return boolean ok
---@return string|nil err
export('AddCustomApp', function(def)
    local ok, err = custom.add(def, GetInvokingResource())
    if not ok then log.warn('apps', 'AddCustomApp from %s refused: %s', tostring(GetInvokingResource()), tostring(err)) end
    return ok, err
end)

---Take a custom app this resource registered away.
---@param id string
---@return boolean ok
---@return string|nil err
export('RemoveCustomApp', function(id)
    return custom.remove(id, GetInvokingResource())
end)

---Every custom app registered right now.
---@return table[] { id, label, resource, description?, developer?, version?, ui?, icon? }
export('GetCustomApps', function()
    local out = {}
    for _, app in ipairs(custom.all()) do
        out[#out + 1] = {
            id = app.id, label = app.label, resource = app.resource, description = app.description,
            developer = app.developer, version = app.version, ui = app.ui, icon = app.icon,
        }
    end
    return out
end)

---Push a message to the app's page (computer.onMessage(action, cb) hears it).
---@param target integer a player's server id, or -1 for everyone with the app open
---@param id string
---@param action string
---@param data any
---@return boolean ok
---@return string|nil err
export('SendAppMessage', function(target, id, action, data)
    local app, err = owned(id)
    if not app then return false, err end
    if type(action) ~= 'string' or action == '' then return false, 'action must be a non-empty string' end
    send(targets(target, app, true), 'message', { app = app.osId, action = action, data = data })
    return true
end)

---A notification on the desktop from the app (its icon and name on it; clicking it brings the app up).
---@param target integer a player's server id, or -1 for everyone who has the app
---@param id string
---@param n { title: string, body?: string, data?: any }
---@return boolean ok
---@return string|nil err
export('NotifyApp', function(target, id, n)
    local app, err = owned(id)
    if not app then return false, err end
    if type(n) ~= 'table' or type(n.title) ~= 'string' or n.title == '' then return false, 'the notification needs a title' end
    send(targets(target, app, false), 'notify', {
        app = app.osId,
        title = text.clip(n.title, 80),
        body = type(n.body) == 'string' and text.clip(n.body, 240) or nil,
        data = n.data,
    })
    return true
end)

---The count on the app's icon (0 clears it). Kept per player, so it is there at the next computer.
---@param target integer a player's server id, or -1 for every player online
---@param id string
---@param count integer
---@return boolean ok
---@return string|nil err
export('SetAppBadge', function(target, id, count)
    local app, err = owned(id)
    if not app then return false, err end
    local list = {}
    if target == -1 then
        for _, p in ipairs(GetPlayers()) do list[#list + 1] = tonumber(p) end
    else
        list[1] = math.tointeger(tonumber(target))
        if not list[1] then return false, 'target must be a server id or -1' end
        -- (a count kept for nobody would never be cleared: playerDropped is what clears them)
        if not GetPlayerName(list[1]) then return false, 'no player with that server id' end
    end
    for _, src in ipairs(list) do
        local n = custom.setBadge(src, app, count)
        if session.get(src) then TriggerClientEvent('sd-computers:client:app', src, 'badge', { app = app.osId, count = n }) end
    end
    return true
end)

---Open the app's window on a player's desktop (they must be signed in at a computer that has it).
---@param src integer
---@param id string
---@param props any handed to the page (computer.launch, computer.onLaunch)
---@return boolean ok
---@return string|nil err
export('OpenApp', function(src, id, props)
    local app, err = owned(id)
    if not app then return false, err end
    if src == -1 then return false, 'OpenApp opens the app for one player: pass their server id' end
    local list = targets(src, app, false)
    if #list == 0 then return false, 'that player is not signed in at a computer with this app' end
    send(list, 'open', { app = app.osId, props = props })
    return true
end)

---Close the app's window on a player's desktop.
---@param src integer
---@param id string
---@return boolean ok
---@return string|nil err
export('CloseApp', function(src, id)
    local app, err = owned(id)
    if not app then return false, err end
    send(targets(src, app, true), 'close', { app = app.osId })
    return true
end)

---The players who have the app's window open right now.
---@param id string
---@return integer[]
export('GetAppUsers', function(id)
    local app = custom.get(id)
    return app and users(app, true) or {}
end)

---Whether a player is signed in at a computer that has the app.
---@param src integer
---@param id string
---@return boolean
export('HasApp', function(src, id)
    local app = custom.get(id)
    return app ~= nil and #targets(src, app, false) > 0
end)

---Where a player is sitting: the context an app's functions are handed, with `signedIn`. nil
---when they have no computer open.
---@param src integer
---@return table|nil
export('GetComputerSession', function(src)
    local player = math.tointeger(tonumber(src))
    local s = player and session.get(player)
    if not s then return nil end
    local ctx = session.contextOf(player, s)
    ctx.signedIn = s.signedIn == true
    return ctx
end)

---Look at the custom apps' gates again for one player (or, with nil, for everyone at a computer):
---after something they check changed - a job, an item, whatever `check` reads.
---@param src integer|nil
export('RefreshApps', function(src)
    CreateThread(function()
        if src ~= nil then
            session.refreshCustom(math.tointeger(tonumber(src)) or -1)
            return
        end
        for _, holder in ipairs(session.holders()) do session.refreshCustom(holder.src) end
    end)
end)

return {}
