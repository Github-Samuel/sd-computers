---@type table sd-computers config root (configs/config.lua).
local config = require 'configs.config'
---@type table Console log helper (shared.log): tagged color-coded prints.
local log = require 'shared.log'
---@type table The camera at the screen (client.computers.view).
local view = require 'client.computers.view'
---@type table Where the screen is on each prop (client.screens.quads).
local quads = require 'client.screens.quads'

---@type table Client computer state module; the table returned at end of file.
local state = {}

---@class OpenComputer
---@field id string computer id
---@field coords vector3 the machine's position (walk-away checks run against it)
---@field instance string|nil the per-machine key the server gave this session (shared.instance)

---@type OpenComputer|nil The computer the player is using (nil when none).
local current
---@type boolean An open is in flight (debounces double-clicking the target).
local opening = false
---@type fun()[] Run as a computer closes, before the camera leaves its screen (the Security
---Cameras app hands the display back) - a hook list, so this file never depends on its users.
local closeHooks = {}
---@type fun(payload: table)[] Run with the open payload as a computer opens (client/computers/apps.lua
---learns which custom apps it has).
local openHooks = {}

---Hear about a computer opening, with the payload the OS boots from.
---@param fn fun(payload: table)
function state.onOpen(fn)
    openHooks[#openHooks + 1] = fn
end

---Hear about the computer closing, however it does (shut down, walked away, the server, a restart),
---with the computer it was ({ id, instance, coords }, nil when none was open).
---@param fn fun(closing: table|nil)
function state.onClose(fn)
    closeHooks[#closeHooks + 1] = fn
end

---@param closing OpenComputer|nil
local function runCloseHooks(closing)
    local info = closing and { id = closing.id, instance = closing.instance, coords = closing.coords } or nil
    for _, fn in ipairs(closeHooks) do
        local ok, err = pcall(fn, info)
        if not ok then log.error('computer', 'close hook failed: %s', tostring(err)) end
    end
end

---@type table|false Typing animation config (config.Interact.Anim); false = no animation.
local ANIM = config.Interact and config.Interact.Anim or false
---@type number Walk-away distance before the computer closes itself.
local MAX_DISTANCE = (config.Interact and config.Interact.MaxDistance) or 2.5
---@type number Metres from a model computer's coords its prop is looked for when the caller did not hand it over.
local PROP_RADIUS = 0.5

---Play the typing loop (flag 49: upper body only, so turning still works). Idempotent.
local function playAnim()
    if not ANIM or not ANIM.dict then return end
    local ped = cache.ped
    lib.requestAnimDict(ANIM.dict)
    if not IsEntityPlayingAnim(ped, ANIM.dict, ANIM.clip or 'base', 3) then
        TaskPlayAnim(ped, ANIM.dict, ANIM.clip or 'base', 8.0, 1.0, -1, 49, 0.0, false, false, false)
    end
end

---Stop the typing loop. Idempotent.
local function stopAnim()
    if ANIM and ANIM.dict then StopAnimTask(cache.ped, ANIM.dict, ANIM.clip or 'base', 2.0) end
end

---Is a computer open right now?
---@return boolean
function state.isOpen()
    return current ~= nil
end

---The per-machine key of the computer the player is using (nil when none) - so its screen in the
---world knows it is the player's own.
---@return string|nil
function state.instance()
    return current and current.instance or nil
end

---The computer the player is using: { id, instance, coords } (nil when none).
---@return table|nil
function state.computer()
    if not current then return nil end
    return { id = current.id, instance = current.instance, coords = current.coords }
end

---Close the computer: hide the NUI, drop focus, stop the animation and (unless the server asked
---for this close) tell the server so the session + logoff are recorded. Idempotent.
---@param reason? string notification shown to the player (walked away, lost access, ...)
---@param fromServer? boolean true when the server already ended the session
function state.close(reason, fromServer)
    if not current then return end
    local closing = current
    current = nil
    runCloseHooks(closing)
    SendNUIMessage({ action = 'computers:close' })
    SetNuiFocus(false, false)
    view.leave()
    stopAnim()
    if not fromServer then TriggerServerEvent('sd-computers:server:close') end
    if reason then lib.notify({ description = reason, type = 'error' }) end
end

---Watch the open computer: walking away (or dying) closes it, and the typing anim is re-asserted
---if something cancelled it. UX only - the server re-checks reach on every action itself.
---@param watched OpenComputer
local function watch(watched)
    CreateThread(function()
        while current == watched do
            local ped = cache.ped
            if IsEntityDead(ped) or #(GetEntityCoords(ped) - watched.coords) > MAX_DISTANCE then
                state.close(locale('err.too_far'))
                break
            end
            playAnim()
            Wait(500)
        end
    end)
end

---Open a computer: ask the server (it validates reach, job lock and that nobody else is using it),
---then turn to face it, start typing, take the camera up to its screen and boot the NUI to the
---lock screen there. A computer with no screen to go to boots fullscreen.
---@param id string computer id
---@param coords vector3 the machine's position (config coords, or the prop's coords for model computers)
---@param isModel boolean model computer? (the server only trusts client coords for those)
---@param style? string force a look (Desktop.Styles key) instead of the computer's configured one
---@param prop? integer|false the prop the computer is; nil = look for one at `coords`, false = it has none
function state.open(id, coords, isModel, style, prop)
    if current or opening then return end
    opening = true
    local res = lib.callback.await('sd-computers:server:open', false, id, isModel and { x = coords.x, y = coords.y, z = coords.z } or nil, style)
    opening = false
    if not res or not res.ok then
        lib.notify({ description = res and res.error or locale('err.internal'), type = 'error' })
        return
    end

    local session = { id = id, coords = coords, instance = res.data and res.data.computer and res.data.computer.instance }
    current = session
    TaskTurnPedToFaceCoord(cache.ped, coords.x, coords.y, coords.z, 600)
    SetTimeout(600, function()
        if current then playAnim() end
    end)
    watch(session)

    -- (a model computer's coords ARE its prop's; a location's are its zone's, with the prop somewhere in it)
    if prop == nil then prop = quads.near(coords, isModel and PROP_RADIUS or quads.ZONE_RADIUS) end
    local rect = view.enter(prop or nil) -- (yields while the camera travels)
    if current ~= session then return end -- (walked off on the way)
    if rect then
        res.data.view = rect
        res.data.desktop.monitor = false -- (the prop is the monitor: retro leaves its own chassis off)
    end
    for _, fn in ipairs(openHooks) do
        local ok, err = pcall(fn, res.data)
        if not ok then log.error('computer', 'open hook failed: %s', tostring(err)) end
    end
    SetNuiFocus(true, true)
    SendNUIMessage({ action = 'computers:open', data = res.data })
    log.debug('computer', 'opened %s', id)
end

---Server -> client: the session ended server-side (walked out of reach, lost access, resource
---restart) - close without telling the server back.
---@param reason string|nil localized reason
RegisterNetEvent('sd-computers:client:forceClose', function(reason)
    state.close(reason, true)
end)

---Resource stopping: release focus, the camera and the animation (the NUI dies with the resource).
function state.shutdown()
    runCloseHooks(current)
    view.shutdown()
    if current then
        SetNuiFocus(false, false)
        stopAnim()
        current = nil
    end
end

return state
