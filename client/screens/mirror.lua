---@type table sd-computers config root (configs/config.lua).
local config = require 'configs.config'
---@type table Console log helper (shared.log): tagged color-coded prints.
local log = require 'shared.log'
---@type table Client computer state (client.computers.state).
local state = require 'client.computers.state'
---@type table The browsers behind the screens (client.screens.dui).
local dui = require 'client.screens.dui'

---@type table Live-copy settings (config.Screens.Mirror).
local M = (config.Screens and config.Screens.Mirror) or {}

-- The live copy of a computer somebody is using. Two halves, and a player can be both at once:
--   the one at the computer - their NUI records what it draws and hands the recording here in
--     numbered batches, which go to the server to be passed on (server/computers/mirror.lua);
--   the ones standing near - each computer they can see in use gets a browser that plays the
--     recording back. Batches can arrive out of order (a big one travels slower than a small one),
--     so they are put back in order here; one that never shows up is answered by asking for a
--     fresh snapshot and starting over from it.
-- Nothing here reads a batch: it is a string from the recorder to the player.

---@type table Mirror module; the table returned at end of file.
local mirror = {}

---@type integer Bytes: batches up to this go as ordinary events, larger ones as latent events.
local SMALL = 4 * 1024
---@type integer Bytes a second a latent batch is sent to the server at.
local LATENT_BPS = 256 * 1024
---@type integer ms a page gets to say it has loaded before it is taken to have.
local READY_MS = 2500
---@type integer ms a missing batch (or a snapshot that was asked for) is waited on before asking again.
local RESYNC_MS = 2500
---@type integer Most batches held while an earlier one is still on its way.
local MAX_HELD = 64
---@type string GlobalState key the server publishes where the custom apps' pages and icons come from under.
local HOSTS_KEY = 'sd-computers:appHosts'

---@class LiveScreen
---@field key string the computer's instance
---@field n integer which session on it (a new one starts over)
---@field vw integer width of the part of the texture the page draws in (px)
---@field vh integer its height
---@field id integer the page's own number (it names itself with it when it has loaded)
---@field browser table client.screens.dui browser
---@field since integer GetGameTimer() the page was asked for
---@field ready boolean the page has loaded
---@field asked integer|nil GetGameTimer() a snapshot was last asked for
---@field expect integer|nil the next batch to play (nil = waiting for a snapshot)
---@field held table<integer, { blob: string, full: boolean }> batches that arrived early
---@field gap integer|nil GetGameTimer() the first batch out of order arrived

---@type table<string, LiveScreen> instance -> the copy playing it.
local live = {}
---@type table<integer, LiveScreen> page number -> the same.
local pages = {}
---@type integer
local lastPage = 0

---@param e LiveScreen
---@param blob string
---@param reset boolean the batch is a whole-screen snapshot to start (over) from
local function play(e, blob, reset)
    dui.send(e.browser, { action = 'mirror:batch', data = { blob = blob, reset = reset } })
end

---Play every held batch that is next in line.
---@param e LiveScreen
local function drain(e)
    while e.expect and e.held[e.expect] do
        local b = e.held[e.expect]
        e.held[e.expect] = nil
        -- (a snapshot another watcher asked for changes nothing for a page already in step)
        if not b.full then play(e, b.blob, false) end
        e.expect = e.expect + 1
    end
    for seq in pairs(e.held) do
        if seq < e.expect then e.held[seq] = nil end
    end
    if next(e.held) == nil then e.gap = nil end
end

---@param e LiveScreen
local function stop(e)
    live[e.key] = nil
    pages[e.id] = nil
    TriggerServerEvent('sd-computers:server:mirror:unwatch', e.key)
    dui.release(e.browser)
    log.debug('screens', 'stopped watching %s', e.key)
end

---@param w { key: string, n: integer, style: string, vw: integer, vh: integer }
local function start(w)
    lastPage = lastPage + 1
    local e = {
        key = w.key, n = w.n, vw = w.vw, vh = w.vh, id = lastPage,
        since = GetGameTimer(), ready = false, held = {},
    }
    -- (the page loads nothing from anywhere it is not told it may: the custom apps' hosts, for
    -- their icons and what their pages show)
    e.browser = dui.acquire(dui.url('live', w.style, {
        id = e.id, vw = w.vw, vh = w.vh,
        apps = GlobalState[HOSTS_KEY] or '',
    }))
    live[w.key] = e
    pages[e.id] = e
    log.debug('screens', 'watching %s', w.key)
end

---Say which computers in use this client should be showing, nearest first. Ones no longer wanted
---are let go; a computer whose session changed starts over.
---@param wanted { key: string, n: integer, style: string, vw: integer, vh: integer }[]
function mirror.assign(wanted)
    local keep = {}
    for _, w in ipairs(wanted) do
        keep[w.key] = true
        local e = live[w.key]
        if e and (e.n ~= w.n or e.vw ~= w.vw or e.vh ~= w.vh) then stop(e) end
        if not live[w.key] then start(w) end
    end
    for key, e in pairs(live) do
        if not keep[key] then stop(e) end
    end
end

---The texture a computer's live copy is drawn from (nil while it has none, or its page is loading).
---@param key string instance
---@return string|nil txn
---@return number|nil u right edge of the part the page draws in (0-1)
---@return number|nil v its bottom edge
function mirror.texture(key)
    local e = live[key]
    if not e or not e.ready then return nil end
    return e.browser.txn, e.vw / dui.W, e.vh / dui.H
end

---Housekeeping, a couple of times a second: a page that has loaded asks for its first snapshot,
---and one that is waiting too long (for that, or for a batch that went missing) asks again.
function mirror.tick()
    local now = GetGameTimer()
    for _, e in pairs(live) do
        if not e.ready and now - e.since > READY_MS then e.ready = true end
        if e.ready then
            local stuck = e.expect ~= nil and e.gap ~= nil and now - e.gap > RESYNC_MS
            if stuck then e.expect, e.held, e.gap, e.asked = nil, {}, nil, nil end
            if e.expect == nil and (not e.asked or now - e.asked > RESYNC_MS) then
                e.asked = now
                TriggerServerEvent('sd-computers:server:mirror:watch', e.key)
            end
        end
    end
end

---Let every copy go (resource stop).
function mirror.shutdown()
    for _, e in pairs(live) do stop(e) end
end

---A screen's page has loaded and is listening.
---@param data { id: integer }
---@param cb function nui callback
RegisterNUICallback('computers:screen:ready', function(data, cb)
    local e = pages[tonumber(type(data) == 'table' and data.id) or -1]
    if e then e.ready = true end
    cb({ ok = true })
end)

---Server -> watcher: one batch of a session's recording.
---@param key string instance
---@param seq integer the batch's place in the recording
---@param full boolean it starts with a whole-screen snapshot
---@param blob string
RegisterNetEvent('sd-computers:client:mirror:batch', function(key, seq, full, blob)
    local e = live[key]
    if not e or type(seq) ~= 'number' or type(blob) ~= 'string' then return end
    if e.expect == nil then
        if full then
            play(e, blob, true)
            e.expect = seq + 1
            drain(e)
        elseif not e.held[seq] then
            -- (ahead of the snapshot it follows: keep it for when that lands)
            local n = 0
            for _ in pairs(e.held) do n = n + 1 end
            if n >= MAX_HELD then e.held = {} end
            e.held[seq] = { blob = blob, full = false }
        end
        return
    end
    if seq < e.expect then return end
    e.held[seq] = { blob = blob, full = full == true }
    if seq > e.expect then e.gap = e.gap or GetGameTimer() end
    drain(e)
end)

---Server -> the player at the computer: start recording (and send a fresh snapshot), or stop.
---@param on boolean
RegisterNetEvent('sd-computers:client:mirror:record', function(on)
    if not state.isOpen() then return end
    SendNUIMessage({ action = 'computers:mirror', data = { record = on == true, canvasFps = tonumber(M.CanvasFps) or 0 } })
end)

---The NUI recorded something: send it on its way.
---@param data { seq: integer, full: boolean, blob: string }
---@param cb function nui callback
RegisterNUICallback('computers:mirror:batch', function(data, cb)
    cb({ ok = true })
    if not state.isOpen() or type(data) ~= 'table' or type(data.blob) ~= 'string' then return end
    local seq = math.tointeger(tonumber(data.seq) or -1)
    if not seq or seq < 0 then return end
    if #data.blob > SMALL then
        TriggerLatentServerEvent('sd-computers:server:mirror:batch', LATENT_BPS, seq, data.full == true, data.blob)
    else
        TriggerServerEvent('sd-computers:server:mirror:batch', seq, data.full == true, data.blob)
    end
end)

return mirror
