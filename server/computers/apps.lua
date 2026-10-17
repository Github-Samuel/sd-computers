---@type table sd-computers config root (configs/config.lua).
local config = require 'configs.config'
---@type table Console log helper (shared.log): tagged color-coded prints.
local log = require 'shared.log'
---@type table UTF-8-safe clipping (shared.text).
local text = require 'shared.text'
---@type table Job predicates (bridge.server.job).
local job = require 'bridge.server.job'
---@type table Gang predicates (bridge.server.gang).
local gang = require 'bridge.server.gang'
---@type table Inventory adapter (bridge.server.inventory): the `items` gate.
local inventory = require 'bridge.server.inventory'

-- Custom apps: programs other resources put on the desktop (exports['sd-computers']:AddCustomApp).
-- This file is the registry - what an app is, who registered it, and which players get it on
-- which computer. The page, the SDK and the window live in web/src/apps/ext; the calls the page
-- makes and every export are server/computers/appapi.lua.
--
-- An app is the registering resource's own: only it can change or remove it, and it goes when
-- that resource stops. On the desktop its id is `ext:<id>`, so it can never be mistaken for one
-- of the OS's own apps, and the session gate (session.guard) treats it like any other installed app.

---@type table Custom apps config (configs/shared/apps.lua).
local A = config.Apps or {}

---@type table Registry module; the table returned at end of file.
local apps = {}

---@type string What a custom app's id is prefixed with on the desktop.
apps.PREFIX = 'ext:'

---@class CustomApp
---@field id string the registering resource's id for it ('wrenchworks')
---@field osId string its id on the desktop ('ext:wrenchworks')
---@field resource string who registered it
---@field label string
---@field ui string|nil the page, as an address the OS can frame
---@field icon string|nil
---@field color string|nil '#rrggbb'
---@field description string|nil
---@field developer string|nil
---@field version string|nil
---@field w integer
---@field h integer
---@field resizable boolean
---@field desktop boolean an icon on the desktop
---@field pinned boolean on the taskbar / dock
---@field computers table<string, boolean>|nil the computers it is on (nil = every one)
---@field styles table<string, boolean>|nil the looks it is on (nil = every one)
---@field groups table<string, integer>|nil jobs/gangs it is for (nil = everyone)
---@field items string[]|nil items the player has to carry, every one of them
---@field check function|nil (src, ctx) -> true when the player gets it
---@field onOpen function|nil (src, ctx)
---@field onClose function|nil (src, ctx)
---@field print function|nil (src, data, ctx) -> page
---@field endpoints table<string, function>

---@type table<string, CustomApp> id -> app.
local byId = {}
---@type string[] ids in the order they were first registered: the order they sit on the desktop.
local order = {}

---@type fun()[] Run when the registry changes (an app added, replaced or taken away).
local changeHooks = {}

---@type string This resource: no app may frame it (its pages are the OS's own origin).
local SELF = GetCurrentResourceName():lower()

---@type table<string, boolean> Ids the desktop uses for windows that are not apps of their own.
local RESERVED = { hack = true, mines = true, solitaire = true, snake = true, system = true, any = true }

local MAX_LABEL = 48
local MAX_ENDPOINTS = 128

---Whether a value can be called. A function handed over through an export arrives as a function
---reference: a table with a __call metamethod, not a Lua function.
---@param value any
---@return boolean
local function callable(value)
    if type(value) == 'function' then return true end
    if type(value) ~= 'table' then return false end
    local meta = getmetatable(value)
    return type(meta) == 'table' and meta.__call ~= nil
end
apps.callable = callable

---A clean one-line string, clipped (nil when nothing is left).
---@param raw any
---@param max integer
---@return string|nil
local function line(raw, max)
    if type(raw) ~= 'string' then return nil end
    local s = text.trim((raw:gsub('%c', ' ')))
    if s == '' then return nil end
    return text.clip(s, max)
end

---A list of strings from a string or an array of them (nil when there are none).
---@param raw any
---@return string[]|nil
local function strings(raw)
    if type(raw) == 'string' then raw = { raw } end
    if type(raw) ~= 'table' then return nil end
    local out = {}
    for _, v in ipairs(raw) do
        if type(v) == 'string' and v ~= '' then out[#out + 1] = v end
    end
    return #out > 0 and out or nil
end

---A set of strings from a string or an array of them (nil when there are none).
---@param raw any
---@return table<string, boolean>|nil
local function set(raw)
    local list = strings(raw)
    if not list then return nil end
    local out = {}
    for _, v in ipairs(list) do out[v] = true end
    return out
end

---A job/gang lock as { name = minGrade }: from a name, an array of names (any grade) or that map
---already. nil when it names nobody.
---@param raw any
---@return table<string, integer>|nil
local function groupsOf(raw)
    if type(raw) == 'string' then raw = { raw } end
    if type(raw) ~= 'table' then return nil end
    local out, any = {}, false
    for k, v in pairs(raw) do
        if type(k) == 'string' and k ~= '' then
            out[k] = math.max(0, math.floor(tonumber(v) or 0))
            any = true
        elseif type(v) == 'string' and v ~= '' then
            out[v] = 0
            any = true
        end
    end
    return any and out or nil
end

---A page or picture of a resource, as the address the OS frames: 'my-res/ui/index.html' and
---'nui://my-res/ui/index.html' become https://cfx-nui-my-res/ui/index.html, an http(s) address is
---kept (a dev server, or a site), anything else is refused. Never one of this resource's pages.
---@param raw any
---@return string|nil url
---@return string|nil err
local function address(raw)
    if type(raw) ~= 'string' or raw == '' then return nil end
    local s = raw:gsub('^%s+', ''):gsub('%s+$', '')
    if #s > 512 or s:find('[%s"\'<>\\]') then return nil, 'is not an address' end
    local url
    if s:match('^https?://') then
        url = s
    else
        local path = s:gsub('^nui://', ''):gsub('^/', '')
        local res, rest = path:match('^([%w_%-%.]+)/(.+)$')
        if not res then return nil, 'must be "resource/path" or an http(s) address' end
        url = ('https://cfx-nui-%s/%s'):format(res, rest)
    end
    local host = url:match('^https?://([^/:]+)')
    if not host then return nil, 'has no host' end
    if host:lower() == 'cfx-nui-' .. SELF then return nil, ('cannot be a page of %s itself'):format(SELF) end
    return url
end

---Read an app definition from AddCustomApp into a CustomApp, or say what is wrong with it.
---@param d table
---@param resource string
---@return CustomApp|nil app
---@return string|nil err
local function read(d, resource)
    local id = d.id or d.identifier
    if type(id) ~= 'string' or not id:match('^[a-z0-9][a-z0-9_%-]*$') or #id > 48 then
        return nil, 'id must be 1-48 characters of a-z, 0-9, _ and -, starting with a letter or digit'
    end
    if config.Desktop.Apps[id] or RESERVED[id] then return nil, ('%s is the id of one of the desktop\'s own apps'):format(id) end
    local label = line(d.label or d.name, MAX_LABEL)
    if not label then return nil, 'label is required' end

    local ui, uiErr = address(d.ui)
    if uiErr then return nil, 'ui ' .. uiErr end
    local icon, iconErr = address(d.icon)
    if iconErr then return nil, 'icon ' .. iconErr end

    local size = type(d.size) == 'table' and d.size or {}
    local w = math.floor(tonumber(size.w or size.width or d.width) or 900)
    local h = math.floor(tonumber(size.h or size.height or d.height) or 600)

    local styles
    if d.styles ~= nil then
        styles = {}
        for style in pairs(set(d.styles) or {}) do
            if config.Desktop.Styles[style] then styles[style] = true end
        end
        if next(styles) == nil then return nil, 'styles names no look this server has' end
    end

    local endpoints, count = {}, 0
    if d.endpoints ~= nil and type(d.endpoints) ~= 'table' then return nil, 'endpoints must be a table of functions' end
    for name, fn in pairs(d.endpoints or {}) do
        if type(name) ~= 'string' or not name:match('^[%w_%-:%.]+$') or #name > 64 then
            return nil, ('endpoint name %s must be 1-64 characters of letters, digits, _ - : .'):format(tostring(name))
        end
        if not callable(fn) then return nil, ('endpoint %s is not a function'):format(name) end
        count = count + 1
        endpoints[name] = fn
    end
    if count > MAX_ENDPOINTS then return nil, ('more than %d endpoints'):format(MAX_ENDPOINTS) end

    for _, hook in ipairs({ 'check', 'onOpen', 'onClose', 'print' }) do
        if d[hook] ~= nil and not callable(d[hook]) then return nil, hook .. ' must be a function' end
    end

    local color = type(d.color) == 'string' and d.color:match('^#%x%x%x%x%x%x$') and d.color:lower() or nil

    return {
        id = id, osId = apps.PREFIX .. id, resource = resource, label = label,
        ui = ui, icon = icon, color = color,
        description = line(d.description, 200), developer = line(d.developer, MAX_LABEL), version = line(d.version, 16),
        w = math.max(320, math.min(1600, w)), h = math.max(200, math.min(1000, h)),
        resizable = d.resizable ~= false, desktop = d.desktop ~= false, pinned = d.pinned == true,
        computers = set(d.computers), styles = styles, groups = groupsOf(d.groups), items = strings(d.items or d.item),
        check = d.check, onOpen = d.onOpen, onClose = d.onClose, print = d.print,
        endpoints = endpoints,
    }
end

local function changed()
    for _, fn in ipairs(changeHooks) do
        local ok, err = pcall(fn)
        if not ok then log.error('apps', 'change hook failed: %s', tostring(err)) end
    end
end

---Hear about the registry changing (session.lua gives the open desktops their new lists).
---@param fn fun()
function apps.onChanged(fn)
    changeHooks[#changeHooks + 1] = fn
end

---Register an app, or replace the one this resource registered under the same id.
---@param d any the definition
---@param resource string|nil the resource asking (GetInvokingResource)
---@return boolean ok
---@return string|nil err
function apps.add(d, resource)
    if type(resource) ~= 'string' or resource == '' then return false, 'could not tell which resource is calling' end
    if type(d) ~= 'table' then return false, 'the app must be a table' end
    local app, err = read(d, resource)
    if not app then return false, err end

    local existing = byId[app.id]
    if existing and existing.resource ~= resource then
        return false, ('%s is already registered by %s'):format(app.id, existing.resource)
    end
    for _, blocked in ipairs(A.Blocked or {}) do
        if blocked == app.id then return false, ('%s is blocked in configs/shared/apps.lua'):format(app.id) end
    end
    if not existing and #order >= (A.MaxApps or 64) then
        return false, ('the server allows %d custom apps (configs/shared/apps.lua MaxApps)'):format(A.MaxApps or 64)
    end

    byId[app.id] = app
    if not existing then order[#order + 1] = app.id end
    log.debug('apps', '%s %s from %s', existing and 'replaced' or 'registered', app.id, resource)
    changed()
    return true
end

---Take an app away. Only the resource that registered it may.
---@param id any
---@param resource string|nil the resource asking
---@return boolean ok
---@return string|nil err
function apps.remove(id, resource)
    local app = type(id) == 'string' and byId[id] or nil
    if not app then return false, ('no custom app %s'):format(tostring(id)) end
    if app.resource ~= resource then return false, ('%s belongs to %s'):format(id, app.resource) end
    byId[id] = nil
    for i, v in ipairs(order) do
        if v == id then
            table.remove(order, i)
            break
        end
    end
    log.debug('apps', 'removed %s', id)
    changed()
    return true
end

---An app by its id ('wrenchworks') or its desktop id ('ext:wrenchworks').
---@param id any
---@return CustomApp|nil
function apps.get(id)
    if type(id) ~= 'string' then return nil end
    if id:sub(1, #apps.PREFIX) == apps.PREFIX then id = id:sub(#apps.PREFIX + 1) end
    return byId[id]
end

---Every app, in the order they were registered.
---@return CustomApp[]
function apps.all()
    local out = {}
    for _, id in ipairs(order) do out[#out + 1] = byId[id] end
    return out
end

---Whether a player clears an app's gates on a computer. Cosmetic as far as the app's own data
---goes: a resource still checks what matters in its endpoints (they only ever run for a player
---who has the app open here, which these gates decide).
---@param app CustomApp
---@param src integer
---@param ctx table what is passed to the app's check: { source, citizenid, name, computer }
---@return boolean
local function allowed(app, src, ctx)
    if app.computers and not app.computers[ctx.computer.id] then return false end
    if app.styles and not app.styles[ctx.computer.style] then return false end
    if app.groups then
        local any = false
        for name, minGrade in pairs(app.groups) do
            if job.has(src, name, minGrade) or gang.has(src, name, minGrade) then
                any = true
                break
            end
        end
        if not any then return false end
    end
    for _, item in ipairs(app.items or {}) do
        if not inventory.has(src, item, 1) then return false end
    end
    if app.check then
        local ok, res = pcall(app.check, src, ctx)
        if not ok then
            local why = res ~= nil and tostring(res) or ('see the error from ' .. app.resource .. ' above')
            log.warn('apps', '%s check failed: %s', app.id, why)
            return false
        end
        if res ~= true then return false end
    end
    return true
end

---The desktop ids of the apps a player gets on a computer, in registration order.
---@param src integer
---@param ctx table { source, citizenid, name, computer = { id, label, hostname, instance, style } }
---@return string[]
function apps.forPlayer(src, ctx)
    local out = {}
    if A.Enabled == false then return out end
    for _, id in ipairs(order) do
        local app = byId[id]
        if app and allowed(app, src, ctx) then out[#out + 1] = app.osId end
    end
    return out
end

---What the NUI is told about an app: the shape of every entry of payload.computer.apps, plus
---`ext`, which only a custom app has (web/src/types.ts ExtAppDef).
---@param app CustomApp
---@return table
function apps.entry(app)
    return {
        id = app.osId, label = app.label, w = app.w, h = app.h, resizable = app.resizable,
        ext = {
            id = app.id, resource = app.resource, ui = app.ui, icon = app.icon, color = app.color,
            description = app.description, developer = app.developer, version = app.version,
        },
    }
end

-- Badges: the count an app shows on its icon (SetAppBadge, computer.setBadge). Kept per player
-- rather than per session, so a count set while they were away is there at the next computer.

---@type table<integer, table<string, integer>> src -> desktop id -> count.
local badges = {}

---Set (0 clears) the count on an app's icon for a player.
---@param src integer
---@param app CustomApp
---@param count any
---@return integer count what it is now
function apps.setBadge(src, app, count)
    local n = math.max(0, math.min(9999, math.floor(tonumber(count) or 0)))
    badges[src] = badges[src] or {}
    badges[src][app.osId] = n > 0 and n or nil
    return n
end

---The counts on a player's app icons: { [desktop id] = count }.
---@param src integer
---@return table<string, integer>
function apps.badgesOf(src)
    local out = {}
    for osId, n in pairs(badges[src] or {}) do
        if apps.get(osId) then out[osId] = n end
    end
    return out
end

AddEventHandler('playerDropped', function()
    badges[source] = nil
end)

---Every app of a resource that stopped goes with it.
AddEventHandler('onResourceStop', function(resource)
    if resource == GetCurrentResourceName() then return end
    local gone = false
    for i = #order, 1, -1 do
        local app = byId[order[i]]
        if app and app.resource == resource then
            byId[order[i]] = nil
            table.remove(order, i)
            gone = true
        end
    end
    if gone then
        log.debug('apps', 'removed the apps of %s (stopped)', resource)
        changed()
    end
end)

return apps
