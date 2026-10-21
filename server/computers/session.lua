---@type table sd-computers config root (configs/config.lua).
local config = require 'configs.config'
---@type table Console log helper (shared.log): tagged color-coded prints.
local log = require 'shared.log'
---@type table Computer definitions + instance ids (server.computers.registry).
local registry = require 'server.computers.registry'
---@type table System Logs writer (server.computers.logs).
local logs = require 'server.computers.logs'
---@type table Roaming per-character settings (server.computers.profile).
local profile = require 'server.computers.profile'
---@type table Job roster adapter, used here only for the Business Manager visibility check.
local employees = require 'server.computers.employees'
---@type table Player resolution helpers (bridge.server.player).
local player = require 'bridge.server.player'
---@type table Job predicates (bridge.server.job).
local job = require 'bridge.server.job'
---@type table Gang predicates (bridge.server.gang).
local gang = require 'bridge.server.gang'
---@type table Optional sd-phone link (server.computers.phone): the phone apps a player gets.
local phone = require 'server.computers.phone'
---@type table Mail on the phone's accounts (server.computers.phonemail): its domain + limits.
local phonemail = require 'server.computers.phonemail'
---@type table The security cameras (server.computers.cameras): which of them a player may watch here.
local cameras = require 'server.computers.cameras'
---@type table The config's computers an admin took away in the panel (server.computers.removed).
local removed = require 'server.computers.removed'
---@type table Custom apps other resources registered (server.computers.apps).
local custom = require 'server.computers.apps'

---@type table Session module; the table returned at end of file.
local session = {}

---@class ComputerSession
---@field def table the computers.lua entry
---@field instance string per-machine key (logs, busy-lock, cooldowns)
---@field hostname string machine name
---@field ip string machine IPv4
---@field coords vector3 where the machine is (distance checks run against this)
---@field apps table<string, boolean> apps this player may use here (boss included only for bosses)
---@field watched table<string, boolean>|nil the cameras looked at this session (each is logged once)
---@field bossJob string|nil job the Business Manager manages, when the player is its boss
---@field signedIn boolean past the lock screen?
---@field citizenid string
---@field name string character "First Last"
---@field openedAt integer os.time() the session opened
---@field style string look this session runs in (Desktop.Styles key)
---@field openApps table<string, boolean>|nil the custom apps whose windows are open (server/computers/appapi.lua)

---@type table<integer, ComputerSession> Open sessions by player server id.
local sessions = {}

---@type table<string, integer> instance id -> server id of the player using it (one user per machine).
local busy = {}

---@type table<string, { fails: integer, lockedUntil: integer }> '<citizenid>|<computer id>' -> PIN failures.
local pinState = {}

---@type fun(src: integer, s: ComputerSession)[] Run when a session ends (hacks.lua abandons a
---breach in progress) - a hook list instead of a require, so session.lua never depends on its users.
local closeHooks = {}

---@type fun(src: integer, s: ComputerSession)[] Run when a session starts (mirror.lua lights the
---computer's screen for the players around it).
local openHooks = {}

---@type fun(src: integer, s: ComputerSession)[] Run as a signed-in session goes back to its lock
---screen, or ends (appapi.lua: the desktop and the custom apps' pages on it are gone).
local lockHooks = {}

---@type number Server-side reach: the client's walk-away distance plus slack for latency + desync.
local REACH = ((config.Interact and config.Interact.MaxDistance) or 2.5) + 2.0

---"FL" initials for the sign-in avatar.
---@param name string
---@return string
local function initials(name)
    local out = {}
    for word in tostring(name):gmatch('%S+') do
        out[#out + 1] = (word:match(utf8.charpattern) or ''):upper()
        if #out == 2 then break end
    end
    return table.concat(out)
end

---The player's job label for the Start menu user tile (framework-specific; '' when unknown).
---@param src integer
---@return string label
local function jobLabel(src)
    local p = player.get(src)
    if not p then return '' end
    if p.PlayerData and p.PlayerData.job then return p.PlayerData.job.label or p.PlayerData.job.name or '' end
    if p.job then return p.job.label or p.job.name or '' end
    return ''
end

---Does the player satisfy a computers.lua `groups` lock (any listed job/gang at its min grade)?
---nil/empty groups = open to everyone.
---@param src integer
---@param groups table|nil { name = minGrade }
---@return boolean
local function inGroups(src, groups)
    if type(groups) ~= 'table' or next(groups) == nil then return true end
    for name, minGrade in pairs(groups) do
        local g = tonumber(minGrade) or 0
        if job.has(src, name, g) or gang.has(src, name, g) then return true end
    end
    return false
end
session.inGroups = inGroups

---Within reach of the machine? (server-side position, never the client's word)
---@param src integer
---@param coords vector3
---@return boolean
local function inReach(src, coords)
    local ped = GetPlayerPed(src)
    if not ped or ped == 0 then return false end
    return #(GetEntityCoords(ped) - coords) <= REACH
end

---Coerce a client-sent coords table to a vector3 (nil when malformed).
---@param c any
---@return vector3|nil
local function toVec(c)
    if type(c) ~= 'table' and type(c) ~= 'vector3' then return nil end
    local x, y, z = tonumber(c.x), tonumber(c.y), tonumber(c.z)
    if not (x and y and z) then return nil end
    return vec3(x, y, z)
end

---The job the Business Manager manages for this player at this computer, or nil when they don't
---get the app here (no `boss` on the computer, feature off, unsupported framework, or not boss).
---@param src integer
---@param def table computers.lua entry
---@return string|nil jobName
local function resolveBossJob(src, def)
    if not def.boss or not (config.Boss and config.Boss.Enabled) then return nil end
    if not employees.supported() then return nil end
    local jobName = def.boss == true and job.getName(src) or def.boss
    if type(jobName) ~= 'string' then return nil end
    if not employees.isBoss(src, jobName) then return nil end
    return jobName
end

---Whether the Company Board is for this player at this computer: it is switched on, the computer
---has not opted out (`board = false`), and they have a job that is a company (configs/shared/board.lua).
---@param src integer
---@param def table computers.lua entry
---@return boolean
local function hasBoard(src, def)
    local B = config.Board or {}
    if B.Enabled == false or def.board == false then return false end
    local name = job.getName(src)
    if type(name) ~= 'string' or name == '' then return false end
    for _, none in ipairs(B.NoBoard or { 'unemployed' }) do
        if none == name then return false end
    end
    return true
end

---Ordered app list for the NUI: the computer's configured order, the phone apps after Mail when
---linked, the Company Board and Security Cameras after the rest when this player gets them, the
---Business Manager slotted in second when they do, and the custom apps other resources registered
---at the end, in the order they were registered.
---@param def table computers.lua entry
---@param apps table<string, boolean>
---@return table[] list { id, label, w, h, resizable?, ext? }
local function appList(def, apps)
    local known = config.Desktop.Apps
    local order = {}
    local placed = {}
    for _, id in ipairs(def.apps or config.Desktop.DefaultApps) do
        if apps[id] and id ~= 'boss' and not placed[id] then order[#order + 1] = id; placed[id] = true end
    end
    -- Phone apps the computer's own list didn't place go right after Mail (or at the end).
    local at = 1
    for i, id in ipairs(order) do if id == 'mail' then at = i + 1 end end
    if at == 1 then at = #order + 1 end
    for _, id in ipairs(phone.APPS) do
        if apps[id] and not placed[id] then table.insert(order, at, id); at = at + 1; placed[id] = true end
    end
    -- (Photos sits with them: it is where the phone's gallery shows)
    if apps.photos and not placed.photos then table.insert(order, at, 'photos'); at = at + 1; placed.photos = true end
    -- (Phone Link sits with the apps it unlocks, linked or not)
    if apps.phonelink and not placed.phonelink then table.insert(order, at, 'phonelink'); placed.phonelink = true end
    for _, id in ipairs({ 'board', 'cameras' }) do
        if apps[id] and not placed[id] then order[#order + 1] = id; placed[id] = true end
    end
    if apps.boss then table.insert(order, math.min(2, #order + 1), 'boss') end
    local out = {}
    for _, id in ipairs(order) do
        local a = known[id]
        out[#out + 1] = { id = id, label = a.label, w = a.size and a.size.w or 900, h = a.size and a.size.h or 600 }
    end
    for _, app in ipairs(custom.all()) do
        if apps[app.osId] then out[#out + 1] = custom.entry(app) end
    end
    return out
end

---Filter one of the Desktop id lists (Pinned/DesktopIcons) down to the apps this session has,
---then add the custom apps that asked to be there (`pinned`, `desktop`).
---@param list string[]|nil
---@param apps table<string, boolean>
---@param flag 'pinned'|'desktop' which of a custom app's switches puts it on this list
---@return string[]
local function filterIds(list, apps, flag)
    local out = {}
    for _, id in ipairs(list or {}) do
        if apps[id] then out[#out + 1] = id end
    end
    for _, app in ipairs(custom.all()) do
        if apps[app.osId] and app[flag] then out[#out + 1] = app.osId end
    end
    return out
end

---The desktop's lists for a session's apps, as the open payload has them, and the counts on the
---custom apps' icons.
---@param src integer
---@param s ComputerSession
---@return { apps: table[], pinned: string[], desktopIcons: string[], badges: table<string, integer> }
local function lists(src, s)
    local D = config.Desktop
    return {
        apps = appList(s.def, s.apps), pinned = filterIds(D.Pinned, s.apps, 'pinned'),
        desktopIcons = filterIds(D.DesktopIcons, s.apps, 'desktop'), badges = custom.badgesOf(src),
    }
end

---What a custom app's code is told about a player at a computer (its check, endpoints, hooks).
---@param src integer
---@param s { def: table, instance: string, hostname: string, ip: string, coords: vector3, style: string, citizenid: string, name: string }
---@return table ctx
local function context(src, s)
    return {
        source = src, citizenid = s.citizenid, name = s.name,
        computer = {
            id = s.def.id, label = s.def.label or s.def.id, hostname = s.hostname, ip = s.ip, instance = s.instance,
            style = s.style, coords = { x = s.coords.x, y = s.coords.y, z = s.coords.z },
        },
    }
end

---@type fun(src: integer, s: ComputerSession)[] Run after a session's custom apps were worked out
---again (appapi.lua closes the windows of the ones it lost).
local customHooks = {}

---Put the custom apps a player gets on a session's app set, in place of the ones it had. The new
---set is worked out first and swapped in at once: an app's check may wait, and an app call made
---meanwhile must not find its app missing.
---@param src integer
---@param s ComputerSession
local function installCustom(src, s)
    local now = {}
    for _, osId in ipairs(custom.forPlayer(src, context(src, s))) do now[osId] = true end
    for id in pairs(s.apps) do
        if id:sub(1, #custom.PREFIX) == custom.PREFIX and not now[id] then s.apps[id] = nil end
    end
    for id in pairs(now) do s.apps[id] = true end
    for _, fn in ipairs(customHooks) do
        local ok, err = pcall(fn, src, s)
        if not ok then log.error('session', 'custom apps hook failed: %s', tostring(err)) end
    end
end

---The Mail app's domain + compose limits: sd-phone's while its mail is linked, else configs/shared/mail.lua.
---`phone` tells the NUI which mail it is (the phone has a Spam folder and phone pushes).
---@param src integer
---@return table
local function mailInfo(src)
    if phone.mailLinked() then
        local c = phonemail.config(src)
        return {
            domain = c.domain, maxRecipients = c.maxRecipients, maxSubject = c.maxSubject, maxBody = c.maxBody,
            minPassword = c.minPassword, maxDisplayName = c.maxName, phone = true,
        }
    end
    local M = config.Mail
    return {
        domain = M.Domain, maxRecipients = M.MaxRecipients, maxSubject = M.MaxSubject,
        maxBody = M.MaxBody, minPassword = M.MinPassword, maxDisplayName = M.MaxDisplayName, phone = false,
    }
end

---The current session of a player (nil when they have no computer open).
---@param src integer
---@return ComputerSession|nil
function session.get(src)
    return sessions[src]
end

---The actor stamp for logs: { cid, name } of the session's player.
---@param s ComputerSession
---@return table actor
function session.actor(s)
    return { cid = s.citizenid, name = s.name }
end

local function sameText(a, b)
    local diff = #a ~ #b
    for i = 1, math.max(#a, #b) do
        diff = diff | ((a:byte(i) or 0) ~ (b:byte(i) or 0))
    end
    return diff == 0
end

---Seconds left on a player's PIN lockout for a computer (0 = not locked out).
---@param citizenid string
---@param id string computer id
---@return integer
local function lockoutLeft(citizenid, id)
    local st = pinState[citizenid .. '|' .. id]
    if not st or not st.lockedUntil then return 0 end
    return math.max(0, st.lockedUntil - os.time())
end

---Open a computer: validate the machine, the player's reach and the group lock, claim the
---machine, and build the boot payload for the NUI (the session starts at the LOCK SCREEN -
---nothing is usable until signIn succeeds).
---@param src integer
---@param id string computer id
---@param coords table|nil the prop's coords (model computers only; location computers use config)
---@param styleOverride any a Desktop.Styles key from the OpenComputer export (ignored when unknown)
---@return table result { ok, data?, error? }
function session.open(src, id, coords, styleOverride)
    local def = registry.get(id)
    -- (one taken away in the admin panel is not a computer until the panel puts it back)
    if not def or removed.is(def.id) then return { ok = false, error = locale('err.unknown_computer') } end

    local at = registry.isModel(def) and toVec(coords) or def.coords
    if not at then return { ok = false, error = locale('err.unknown_computer') } end
    if not inReach(src, at) then return { ok = false, error = locale('err.too_far') } end
    if not inGroups(src, def.groups) then return { ok = false, error = locale('err.no_access') } end

    local citizenid = player.getIdentifier(src)
    if not citizenid then return { ok = false, error = locale('err.no_character') } end

    local instance = registry.instanceId(def, at)
    local holder = busy[instance]
    if holder and holder ~= src and sessions[holder] and sessions[holder].instance == instance then
        return { ok = false, error = locale('err.in_use') }
    end
    if sessions[src] then session.close(src) end

    local apps = registry.apps(def)
    local bossJob = resolveBossJob(src, def)
    if bossJob then apps.boss = true end
    if hasBoard(src, def) then apps.board = true end
    if #cameras.visible(src, def) > 0 then apps.cameras = true end
    if phone.linkApp(def) then apps.phonelink = true end
    -- (Photos is the character's own pictures: every computer has it unless it says `photos = false`)
    if (config.Photos or {}).Enabled ~= false and def.photos ~= false then apps.photos = true end
    for app in pairs(phone.apps(src, def, citizenid, instance)) do apps[app] = true end

    local style = registry.style(def, styleOverride)
    local s = {
        def = def, instance = instance, hostname = registry.hostname(def, at), ip = registry.ip(at),
        coords = at, apps = apps, bossJob = bossJob, signedIn = false,
        citizenid = citizenid, name = player.getName(src), openedAt = os.time(), style = style,
    }
    sessions[src] = s
    busy[instance] = src
    installCustom(src, s) -- (after the machine is claimed: an app's check may wait)
    for _, fn in ipairs(openHooks) do
        local ok, err = pcall(fn, src, s)
        if not ok then log.error('session', 'open hook failed: %s', tostring(err)) end
    end
    log.debug('session', 'open src=%s computer=%s instance=%s style=%s boss=%s', src, id, instance, style, tostring(bossJob))

    local pins = config.Security and config.Security.Pins or {}
    local D = config.Desktop
    local S = registry.styleDef(style)
    local desk = lists(src, s)
    return {
        ok = true,
        data = {
            computer = {
                id = def.id, label = def.label or def.id, hostname = s.hostname, ip = s.ip, instance = instance, style = style,
                requiresPin = pins[def.id] ~= nil, lockedFor = lockoutLeft(citizenid, def.id),
                apps = desk.apps, pinned = desk.pinned, desktopIcons = desk.desktopIcons, badges = desk.badges,
            },
            user = { name = s.name, initials = initials(s.name), job = jobLabel(src) },
            desktop = {
                style = style, osName = S.OsName or style, osBuild = S.OsBuild or '1.0',
                boot = D.Boot ~= false, clock24 = D.Clock24 == true,
                wallpapers = S.Wallpapers or {}, accents = S.Accents or {}, defaultWallpaper = S.DefaultWallpaper, defaultTheme = S.DefaultTheme or 'dark',
                monitor = S.Monitor == true, sounds = S.Sounds ~= false,
                printing = (config.Printers or {}).Enabled ~= false,
            },
            settings = profile.settings(citizenid, style),
            hacks = {
                practice = config.Hacks.Practice ~= false, defaultDifficulty = config.Hacks.DefaultDifficulty or 'medium',
                games = config.Hacks.Games,
            },
            mail = mailInfo(src),
        },
    }
end

---Sign in past the lock screen. Computers with a PIN (configs/server/security.lua) check it here -
---server-side only - with a per-character lockout after too many misses; every attempt, good or
---bad, is written to that computer's System Logs (4624 / 4625 / 4740).
---@param src integer
---@param pin any the PIN typed (ignored when the computer has none)
---@return table result { ok, error?, lockedFor? }
function session.signIn(src, pin)
    local s = sessions[src]
    if not s then return { ok = false, error = locale('err.no_session') } end
    if s.signedIn then return { ok = true } end
    if not inReach(src, s.coords) then session.close(src); return { ok = false, error = locale('err.too_far') } end

    local sec = config.Security or {}
    local expected = sec.Pins and sec.Pins[s.def.id]
    if expected ~= nil then
        local key = s.citizenid .. '|' .. s.def.id
        local left = lockoutLeft(s.citizenid, s.def.id)
        if left > 0 then return { ok = false, error = locale('err.locked_out', left), lockedFor = left } end

        if not sameText(tostring(pin or ''), tostring(expected)) then
            local st = pinState[key] or { fails = 0 }
            st.fails = st.fails + 1
            st.at = os.time()
            pinState[key] = st
            logs.write(s.instance, {
                level = 'failure', source = 'Security', eventId = logs.EVENT.LOGON_FAILED,
                message = locale('logs.logon_failed', s.name),
            }, session.actor(s))
            if st.fails >= (sec.MaxAttempts or 3) then
                st.fails, st.lockedUntil = 0, os.time() + (sec.Lockout or 60)
                logs.write(s.instance, {
                    level = 'failure', source = 'Security', eventId = logs.EVENT.LOCKED_OUT,
                    message = locale('logs.locked_out', s.name, sec.Lockout or 60),
                }, session.actor(s))
                return { ok = false, error = locale('err.locked_out', sec.Lockout or 60), lockedFor = sec.Lockout or 60 }
            end
            return { ok = false, error = locale('err.bad_pin') }
        end
        pinState[key] = nil
    end

    s.signedIn = true
    logs.write(s.instance, {
        level = 'success', source = 'Security', eventId = logs.EVENT.LOGON,
        message = locale('logs.logon', s.name),
    }, session.actor(s))
    return { ok = true }
end

---Back to the lock screen (Win+L / Start > Lock): the session stays open (machine still claimed)
---but every app call is refused until the next sign-in.
---@param src integer
function session.lock(src)
    local s = sessions[src]
    if not s or not s.signedIn then return end
    for _, fn in ipairs(lockHooks) do
        local ok, err = pcall(fn, src, s)
        if not ok then log.error('session', 'lock hook failed: %s', tostring(err)) end
    end
    s.signedIn = false
    logs.write(s.instance, {
        level = 'success', source = 'Security', eventId = logs.EVENT.LOGOFF,
        message = locale('logs.logoff', s.name),
    }, session.actor(s))
end

---Register a function to run whenever a session ends (any reason).
---@param fn fun(src: integer, s: ComputerSession)
function session.onClose(fn)
    closeHooks[#closeHooks + 1] = fn
end

---Register a function to run whenever a session starts (the computer is at its lock screen).
---@param fn fun(src: integer, s: ComputerSession)
function session.onOpen(fn)
    openHooks[#openHooks + 1] = fn
end

---Register a function to run as a signed-in session locks or ends (still signed in while it runs).
---@param fn fun(src: integer, s: ComputerSession)
function session.onLock(fn)
    lockHooks[#lockHooks + 1] = fn
end

---Register a function to run after a session's custom apps were worked out again.
---@param fn fun(src: integer, s: ComputerSession)
function session.onCustomApps(fn)
    customHooks[#customHooks + 1] = fn
end

---End a player's session (shut down / walked away / dropped): log the logoff if they were signed
---in, release the machine. Idempotent.
---@param src integer
---@param force? string locale key: when set, also tells the client to close its NUI with this reason
function session.close(src, force)
    local s = sessions[src]
    if not s then return end
    session.lock(src)
    sessions[src] = nil
    if busy[s.instance] == src then busy[s.instance] = nil end
    for _, fn in ipairs(closeHooks) do
        local ok, err = pcall(fn, src, s)
        if not ok then log.error('session', 'close hook failed: %s', tostring(err)) end
    end
    if force then TriggerClientEvent('sd-computers:client:forceClose', src, locale(force)) end
    log.debug('session', 'close src=%s instance=%s force=%s', src, s.instance, tostring(force))
end

---The gate every app action passes: an open, signed-in session, still in reach, still allowed by
---the group lock, with `app` installed for this player. A failed reach/group check also ends the
---session and closes the client's NUI.
---@param src integer
---@param app string|nil required app id (nil = any signed-in session, e.g. shell/profile calls)
---@return ComputerSession|nil s, string|nil err
function session.guard(src, app)
    local s = sessions[src]
    if not s or not s.signedIn then return nil, locale('err.no_session') end
    if not inReach(src, s.coords) then
        session.close(src, 'err.too_far')
        return nil, locale('err.too_far')
    end
    if not inGroups(src, s.def.groups) then
        session.close(src, 'err.no_access')
        return nil, locale('err.no_access')
    end
    if app and not s.apps[app] then return nil, locale('err.app_missing') end
    if app == 'boss' and not (s.bossJob and employees.isBoss(src, s.bossJob)) then
        return nil, locale('err.not_boss')
    end
    return s, nil
end

---Work out again which of the phone's apps a session has - its player has just linked their phone
---to the machine, or taken it off - and give back the desktop's lists as they now stand, for the
---page to redraw its icons from.
---@param src integer
---@return { apps: table[], pinned: string[], desktopIcons: string[] }|nil lists nil when there is no session
function session.refreshPhone(src)
    local s = sessions[src]
    if not s then return nil end
    for _, id in ipairs(phone.APPS) do s.apps[id] = nil end
    for app in pairs(phone.apps(src, s.def, s.citizenid, s.instance)) do s.apps[app] = true end
    return lists(src, s)
end

---The custom apps a session has, as one string to tell two sets apart by.
---@param s ComputerSession
---@return string
local function customKey(s)
    local ids = {}
    for id in pairs(s.apps) do
        if id:sub(1, #custom.PREFIX) == custom.PREFIX then ids[#ids + 1] = id end
    end
    table.sort(ids)
    return table.concat(ids, ',')
end

---Work out again which custom apps a player gets at the computer they are using (something an
---app's gates look at changed, or an app was registered, replaced or taken away), and send the
---desktop its new lists when that changed anything - always, with `force` (a replaced app may have
---a new label or page). A window of an app that is gone closes.
---@param src integer
---@param force? boolean
---@return boolean sent
function session.refreshCustom(src, force)
    local s = sessions[src]
    if not s then return false end
    local before = customKey(s)
    installCustom(src, s)
    if not force and customKey(s) == before then return false end
    TriggerClientEvent('sd-computers:client:app', src, 'apps', lists(src, s))
    return true
end

---The context a custom app's code is handed for a player at their computer (nil when they have none).
---@param src integer
---@return table|nil ctx
function session.context(src)
    local s = sessions[src]
    return s and context(src, s) or nil
end

---The same context, from a session in hand (one that is ending is no longer looked up by player).
---@param src integer
---@param s ComputerSession
---@return table ctx
function session.contextOf(src, s)
    return context(src, s)
end

-- An app came, went or was replaced: every open desktop is given its lists again. In a thread of
-- its own: this runs inside the AddCustomApp export, and an app's check may wait on something.
custom.onChanged(function()
    CreateThread(function()
        local open = {}
        for src in pairs(sessions) do open[#open + 1] = src end
        for _, src in ipairs(open) do session.refreshCustom(src, true) end
    end)
end)

---Who is sitting at a computer right now (signed in or still at its lock screen), for the admin
---panel's "in use" column.
---@return { src: integer, name: string, id: string, instance: string, signedIn: boolean }[]
function session.holders()
    local out = {}
    for src, s in pairs(sessions) do
        out[#out + 1] = { src = src, name = s.name, id = s.def.id, instance = s.instance, signedIn = s.signedIn == true }
    end
    return out
end

---End every session on one computer: it was moved or taken away from the admin panel.
---@param id string computer id
---@param reason string locale key shown to whoever was using it
function session.closeComputer(id, reason)
    for src, s in pairs(sessions) do
        if s.def.id == id then session.close(src, reason) end
    end
end

---Every open session whose player is signed in, as (src, session) pairs - for pushing live events
---(new mail) only to players actually sitting at a computer.
---@return fun(): integer?, ComputerSession?
function session.active()
    local src, s
    return function()
        repeat src, s = next(sessions, src) until src == nil or (s and s.signedIn)
        return src, s
    end
end

---Box: the computer opens (lock screen). See session.open.
---@param src integer
---@param id string computer id
---@param coords table|nil prop coords (model computers)
lib.callback.register('sd-computers:server:open', function(src, id, coords, style)
    return session.open(src, id, coords, style)
end)

---Lock screen -> desktop. See session.signIn.
---@param src integer
---@param pin any
lib.callback.register('sd-computers:server:signIn', function(src, pin)
    return session.signIn(src, pin)
end)

---Desktop -> lock screen. See session.lock.
RegisterNetEvent('sd-computers:server:lock', function()
    session.lock(source)
end)

---The NUI closed (shut down / ESC / walked away client-side). See session.close.
RegisterNetEvent('sd-computers:server:close', function()
    session.close(source)
end)

AddEventHandler('playerDropped', function()
    session.close(source)
end)

CreateThread(function()
    while true do
        Wait(10 * 60 * 1000)
        local now = os.time()
        for key, st in pairs(pinState) do
            if now - math.max(st.lockedUntil or 0, st.at or 0) > 600 then pinState[key] = nil end
        end
    end
end)

return session
