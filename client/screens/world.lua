---@type table sd-computers config root (configs/config.lua).
local config = require 'configs.config'
---@type table Per-machine keys (shared.instance): the one formula both sides name a machine by.
local instance = require 'shared.instance'
---@type table Client computer state (client.computers.state).
local state = require 'client.computers.state'
---@type table Computers placed from the admin panel (client.computers.placed): their props.
local placed = require 'client.computers.placed'
---@type table Which props are a computer on their own right now (client.computers.auto).
local auto = require 'client.computers.auto'
---@type table The config's computers an admin took away in the panel (client.computers.removed).
local removed = require 'client.computers.removed'
---@type table The camera at the screen the player is using (client.computers.view).
local view = require 'client.computers.view'
---@type table Where the screen is on each prop (client.screens.quads).
local quads = require 'client.screens.quads'
---@type table The browsers behind the screens (client.screens.dui).
local dui = require 'client.screens.dui'
---@type table Live copies of the computers in use (client.screens.mirror).
local mirror = require 'client.screens.mirror'

---@type table Screen settings (config.Screens).
local S = config.Screens or {}
---@type table Live-copy settings (config.Screens.Mirror).
local M = S.Mirror or {}

-- The screens, in the world. Every computer prop near the player that has a screen gets a
-- rectangle drawn over it each frame, textured from a browser: its style's lock face while nobody
-- is at it, the session's live copy while somebody is. A texture swap (AddReplaceTexture, a render
-- target) would be simpler but changes EVERY prop of that model at once; a rectangle per prop is
-- what lets two monitors on one desk show two different things.

---@type table World module; the table returned at end of file.
local world = {}

if S.Enabled == false then
    function world.shutdown() end
    return world
end

---@type string GlobalState key the server publishes the computers in use under.
local STATE_KEY = 'sd-computers:active'
---@type number Metres a screen is drawn from.
local RANGE = S.Distance or 12.0
---@type integer Most screens drawn at once.
local MAX_SCREENS = S.MaxScreens or 12
---@type integer Most computers in use mirrored at once.
local MAX_LIVE = S.MaxLive or 3
---@type boolean Whether a computer nobody is using shows its lock face.
local IDLE = S.Idle ~= 'off'
---@type boolean Whether a computer in use shows its session.
local LIVE = M.Enabled ~= false
---@type number Metres from a location computer's zone centre its screen prop is looked for.
local ZONE_RADIUS = quads.ZONE_RADIUS
---@type number Metres a prop may stand from a session's coords and still be the one it is on.
local SAME_PROP = 1.0
---@type integer ms a style's lock face is kept after the last screen showing it went out of view.
local IDLE_KEEP = 30000
---@type number Width over height of every texture.
local TEX_ASPECT = dui.W / dui.H

---@type table Desktop.Styles, for telling a real style name from a typo.
local STYLES = (config.Desktop and config.Desktop.Styles) or {}
---@type string
local DEFAULT_STYLE = (config.Desktop and STYLES[config.Desktop.DefaultStyle] and config.Desktop.DefaultStyle) or next(STYLES) or 'modern'

---@param style any
---@return string
local function styleOf(style)
    return type(style) == 'string' and STYLES[style] and style or DEFAULT_STYLE
end

-- ── What is where ─────────────────────────────────────────────────────────────────────────

---@type table[] computers.lua entries that are a location. (The ones that are a prop model are
---asked for as they are needed - client/computers/auto.lua - since the admin panel can change them.)
local zones = {}
for _, def in ipairs(config.Computers or {}) do
    if def.coords then zones[#zones + 1] = def end
end

---@type table<string, table> instance -> { style, x, y, z, n }: the computers somebody is using.
local active = GlobalState[STATE_KEY] or {}
AddStateBagChangeHandler(STATE_KEY, 'global', function(_, _, value) active = value or {} end)

---@class Screen
---@field entity integer the prop
---@field quad ScreenQuad
---@field key string the computer's instance
---@field style string the look it idles in
---@field at vector3 the prop's coords
---@field dist number metres from the player
---@field live boolean|nil this is the prop a session in view is on

---@type Screen[] The screens in range, nearest first.
local screens = {}

---Find every computer prop with a screen near the player.
local function scan()
    local origin = GetEntityCoords(cache.ped)
    local found, taken = {}, {}

    ---@param entity integer
    ---@param quad ScreenQuad
    ---@param key string
    ---@param style any
    ---@param at vector3
    local function add(entity, quad, key, style, at)
        taken[entity] = true
        local dist = #(at - origin)
        if dist <= RANGE then
            found[#found + 1] = { entity = entity, quad = quad, key = key, style = styleOf(style), at = at, dist = dist }
        end
    end

    -- Placed computers answer as themselves, whatever else their model is.
    for entity, rec in placed.each() do
        local quad = quads.of(entity)
        if quad then add(entity, quad, rec.key, rec.style, GetEntityCoords(entity)) else taken[entity] = true end
    end

    -- Every other prop around that has a screen.
    local props = {}
    for _, entity in ipairs(GetGamePool('CObject')) do
        if not taken[entity] then
            local model = GetEntityModel(entity)
            local quad = quads.model(model)
            if quad then
                local at = GetEntityCoords(entity)
                if #(at - origin) <= RANGE + ZONE_RADIUS then
                    props[#props + 1] = { entity = entity, quad = quad, model = model, at = at }
                end
            end
        end
    end

    -- A location computer is a zone, not a prop: its screen is the screen prop standing in it.
    ---@param key string the computer's instance
    ---@param at vector3 the zone's centre
    ---@param style any
    local function zone(key, at, style)
        if #(at - origin) > RANGE + ZONE_RADIUS then return end
        local best, bestDist
        for _, p in ipairs(props) do
            local d = #(p.at - at)
            if not taken[p.entity] and d <= ZONE_RADIUS and (not bestDist or d < bestDist) then best, bestDist = p, d end
        end
        if best then add(best.entity, best.quad, key, style, best.at) end
    end
    -- (One the admin panel took away has none: its prop is left to be whatever else it is.)
    for _, def in ipairs(zones) do
        if not removed.is(def.id) then zone(def.id, def.coords, def.style) end
    end
    -- (and a computer another resource added with no prop of its own is a box, the same way)
    for rec in placed.boxes() do
        zone(rec.key, vec3(rec.coords.x, rec.coords.y, rec.coords.z), rec.style)
    end

    -- What is left is a computer when its model is one.
    for _, p in ipairs(props) do
        local def = not taken[p.entity] and auto.def(p.model)
        -- (idling in the style the admin panel gave this prop, or its computer, when it gave one)
        if def then add(p.entity, p.quad, instance.id(def, p.at), auto.style(p.model) or def.style, p.at) end
    end

    table.sort(found, function(a, b) return a.dist < b.dist end)
    for i = #found, MAX_SCREENS + 1, -1 do found[i] = nil end
    screens = found
end

-- ── What each one shows ───────────────────────────────────────────────────────────────────

---@type table<string, { browser: table, seen: integer }> style -> the browser showing its lock face.
local idle = {}

---The lock face texture for a style (the browser is made the first time one is needed).
---@param style string
---@return string txn
local function idleTexture(style)
    local i = idle[style]
    if not i then
        i = { browser = dui.acquire(dui.url('idle', style)) }
        idle[style] = i
    end
    i.seen = GetGameTimer()
    return i.browser.txn
end

---The part of a texture a live copy draws in for a screen of this shape: as large as fits, from the top left.
---@param aspect number
---@return integer vw, integer vh
local function fit(aspect)
    if aspect < TEX_ASPECT then return math.floor(dui.H * aspect + 0.5), dui.H end
    return dui.W, math.floor(dui.W / aspect + 0.5)
end

---@type table[] What the draw loop draws: one entry a screen, corners and texture worked out.
local drawing = {}

---Decide what every screen in range shows and where exactly it is.
local function arrange()
    -- A session is on ONE prop. Two props close enough to share an instance key (model computers
    -- are keyed by rounded coords) must not both show it: the one at the session's coords does.
    local owner = {}
    if LIVE then
        for _, s in ipairs(screens) do
            local a = active[s.key]
            if a then
                local d = #(s.at - vec3(a.x, a.y, a.z))
                local o = owner[s.key]
                if d <= math.max(SAME_PROP, ZONE_RADIUS) and (not o or d < o.d) then owner[s.key] = { screen = s, d = d } end
            end
        end
    end

    local own = state.instance()
    local wanted = {}
    for _, s in ipairs(screens) do
        local a = active[s.key]
        if a and owner[s.key] and owner[s.key].screen == s and #wanted < MAX_LIVE and (s.key ~= own or M.Self) then
            local vw, vh = fit(s.quad.aspect)
            wanted[#wanted + 1] = { key = s.key, n = a.n, style = styleOf(a.style), vw = vw, vh = vh }
            s.live = true
        else
            s.live = false
        end
    end
    mirror.assign(wanted)
    mirror.tick()

    -- Every screen is worked out, the one the player's own desktop is on included. Nothing is
    -- drawn on that one while the desktop is - but that is asked every frame, by the draw loop, not
    -- here twice a second: the moment they get up its lock face has to be there already, or for as
    -- long as this takes to come round again the prop shows the picture it was modelled with.
    -- (Working it out here is also what keeps that lock face's browser from being given back
    -- while they sit.)
    local list = {}
    for _, s in ipairs(screens) do
        if DoesEntityExist(s.entity) then
            local txn, u0, v0, u1, v1
            if s.live then
                txn, u1, v1 = mirror.texture(s.key)
                u0, v0 = 0.0, 0.0
            end
            if not txn and IDLE then
                txn = idleTexture(s.style)
                u0, v0, u1, v1 = dui.cover(s.quad.aspect)
            end
            if txn then
                local tl, tr, bl, br, c, n = quads.place(s.entity, s.quad)
                list[#list + 1] = { entity = s.entity, tl = tl, tr = tr, bl = bl, br = br, c = c, n = n, txn = txn, u0 = u0, v0 = v0, u1 = u1, v1 = v1 }
            end
        end
    end
    drawing = list

    -- A lock face nothing has shown for a while gives its browser back.
    local now = GetGameTimer()
    for style, i in pairs(idle) do
        if now - i.seen > IDLE_KEEP then
            dui.release(i.browser)
            idle[style] = nil
        end
    end
end

-- Look around once a second; in between, keep what is shown in step with who sat down or got up.
CreateThread(function()
    local turn = 0
    while true do
        if turn % 2 == 0 then scan() end
        turn = turn + 1
        arrange()
        Wait(500)
    end
end)

---@type number Metres a screen is drawn further out from its prop for every metre the camera is away
---(client/screens/quads.lua says why).
local LIFT_PER_METRE = quads.LIFT_PER_METRE

-- Draw. A screen is two triangles, wound anticlockwise as seen from the front - the side the game
-- draws - with the texture's corners pinned to the screen's. One seen from behind is skipped.
CreateThread(function()
    local TXD = dui.TXD
    local sqrt = math.sqrt
    while true do
        local list = drawing
        if #list == 0 then
            Wait(500)
        else
            local cam = GetFinalRenderedCamCoord()
            -- (the screen the player's own desktop is on right now is that desktop's: nothing is drawn on it)
            local mine = view.entity()
            for i = 1, #list do
                local d = list[i]
                local c, n = d.c, d.n
                local dx, dy, dz = cam.x - c.x, cam.y - c.y, cam.z - c.z
                if d.entity ~= mine and dx * n.x + dy * n.y + dz * n.z > 0.0 then
                    -- (out along the way the screen faces, by how far the camera is)
                    local lift = sqrt(dx * dx + dy * dy + dz * dz) * LIFT_PER_METRE
                    local ox, oy, oz = n.x * lift, n.y * lift, n.z * lift
                    local tl, tr, bl, br = d.tl, d.tr, d.bl, d.br
                    local blx, bly, blz = bl.x + ox, bl.y + oy, bl.z + oz
                    local trx, try, trz = tr.x + ox, tr.y + oy, tr.z + oz
                    DrawSpritePoly(blx, bly, blz, br.x + ox, br.y + oy, br.z + oz, trx, try, trz, 255, 255, 255, 255, TXD, d.txn, d.u0, d.v1, 1.0, d.u1, d.v1, 1.0, d.u1, d.v0, 1.0)
                    DrawSpritePoly(blx, bly, blz, trx, try, trz, tl.x + ox, tl.y + oy, tl.z + oz, 255, 255, 255, 255, TXD, d.txn, d.u0, d.v1, 1.0, d.u1, d.v0, 1.0, d.u0, d.v0, 1.0)
                end
            end
            Wait(0)
        end
    end
end)

---Stop drawing and give every browser up (resource stop).
function world.shutdown()
    drawing = {}
    mirror.shutdown()
    dui.destroyAll()
end

return world
