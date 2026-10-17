-- Wrenchworks: a garage's work orders, as a program on sd-computers. It is an example of a custom
-- app and uses every part of the API, so it doubles as a template: copy the folder, rename it, and
-- keep what you need.
--
-- The app is registered here, on the server: sd-computers decides which players get it on which
-- computer, and the page reaches the endpoints below only for a player signed in at a computer
-- with the app on it. What the endpoints keep is this resource's own business (here, a KVP).

local APP = 'wrenchworks'
local RESOURCE = GetCurrentResourceName()

local Config = {
    -- Who gets the app (nil = everyone, at every computer). Both are checked by sd-computers.
    Groups = nil, -- e.g. { mechanic = 0 } or 'mechanic'
    Computers = nil, -- e.g. { 'public_pc', 'business_laptop' } (ids from sd-computers' configs/shared/computers.lua)
    MaxOrders = 200,
}

-- ── The orders ──────────────────────────────────────────────────────────────────────────────

---@class WorkOrder
---@field id integer
---@field plate string
---@field model string
---@field customer string
---@field contact string|nil an email address, for the Email button
---@field work string what is to be done
---@field quote integer dollars
---@field status 'open'|'progress'|'done'
---@field color string|nil '#rrggbb' label
---@field photo string|nil an https picture out of the character's Photos
---@field createdBy string
---@field createdAt integer unix seconds
---@field updatedAt integer
---@field closedBy string|nil

---@type WorkOrder[]
local orders = json.decode(GetResourceKvpString('orders') or '[]') or {}
local nextId = GetResourceKvpInt('next_id')
if nextId < 1 then nextId = 1 end

local STATUS = { open = true, progress = true, done = true }

local function save()
    SetResourceKvp('orders', json.encode(orders))
    SetResourceKvpInt('next_id', nextId)
end

local function find(id)
    id = math.tointeger(tonumber(id))
    for i, o in ipairs(orders) do
        if o.id == id then return o, i end
    end
end

---A trimmed one-line string of at most `max` characters (nil when nothing is left).
local function clean(v, max)
    if type(v) ~= 'string' then return nil end
    v = v:gsub('[%c]', ' '):gsub('^%s+', ''):gsub('%s+$', '')
    if v == '' then return nil end
    return v:sub(1, max)
end

---Whole dollars, 0 to 999,999.
local function price(v)
    return math.max(0, math.min(999999, math.floor(tonumber(v) or 0)))
end

---An https picture address (the page picks them out of the character's Photos), or nil.
local function picture(v)
    if type(v) ~= 'string' or not v:match('^https://') then return nil end
    return v:sub(1, 400)
end

---A '#rrggbb' label colour, or nil.
local function colour(v)
    return type(v) == 'string' and v:match('^#%x%x%x%x%x%x$') or nil
end

local function openCount()
    local n = 0
    for _, o in ipairs(orders) do
        if o.status ~= 'done' then n = n + 1 end
    end
    return n
end

-- Every open window gets the new list; every player's icon gets the count of open orders.
local function changed(kind, order, by)
    exports['sd-computers']:SendAppMessage(-1, APP, 'orders', { kind = kind, order = order, by = by, orders = orders })
    exports['sd-computers']:SetAppBadge(-1, APP, openCount())
end

-- ── What the page calls (computer.callServer) ───────────────────────────────────────────────
-- Each runs as (src, data, ctx): ctx = { source, citizenid, name, app, computer = { id, label,
-- hostname, instance, style, ... } }. Return the answer, or false and a message the page is shown
-- (not nil and a message: a nil in front is lost on its way back across resources).

local endpoints = {}

endpoints['orders:list'] = function(_, _, ctx)
    return { orders = orders, me = ctx.name }
end

endpoints['orders:create'] = function(src, data, ctx)
    if type(data) ~= 'table' then return false, 'Nothing to save.' end
    local plate = clean(data.plate, 8)
    if not plate then return false, 'A work order needs the plate.' end
    local work = clean(data.work, 600)
    if not work then return false, 'Say what is to be done.' end
    if #orders >= Config.MaxOrders then return false, 'The order book is full. Delete some finished orders first.' end

    local now = os.time()
    local order = {
        id = nextId,
        plate = plate:upper(),
        model = clean(data.model, 32) or 'Unknown',
        customer = clean(data.customer, 48) or 'Walk-in',
        contact = clean(data.contact, 64),
        work = work,
        quote = price(data.quote),
        status = 'open',
        photo = picture(data.photo),
        color = colour(data.color),
        createdBy = ctx.name,
        createdAt = now,
        updatedAt = now,
    }
    nextId = nextId + 1
    orders[#orders + 1] = order
    save()
    changed('created', order, ctx.name)

    -- Everyone else with the app gets a notification on their desktop; clicking it opens the order.
    for _, p in ipairs(GetPlayers()) do
        local other = tonumber(p)
        if other ~= src then
            exports['sd-computers']:NotifyApp(other, APP, {
                title = ('New work order #%d'):format(order.id),
                body = ('%s %s - %s'):format(order.model, order.plate, order.customer),
                data = { order = order.id },
            })
        end
    end
    return order
end

endpoints['orders:update'] = function(_, data, ctx)
    local order = type(data) == 'table' and find(data.id) or nil
    if not order then return false, 'That work order is gone.' end

    if data.status ~= nil then
        if not STATUS[data.status] then return false, 'Unknown status.' end
        if data.status == 'done' and order.status ~= 'done' then
            order.closedBy = ctx.name
            -- A line in the computer's Event Viewer, from the server (the page can write one too: computer.log).
            exports['sd-computers']:AddLog(ctx.computer.instance, 'information', 'Wrenchworks',
                ('Work order #%d (%s) completed by %s'):format(order.id, order.plate, ctx.name))
        elseif data.status ~= 'done' then
            order.closedBy = nil
        end
        order.status = data.status
    end
    if data.quote ~= nil then order.quote = price(data.quote) end
    if data.work ~= nil then order.work = clean(data.work, 600) or order.work end
    if data.photo ~= nil then order.photo = picture(data.photo) end
    if data.color ~= nil then order.color = colour(data.color) end
    order.updatedAt = os.time()
    save()
    changed('updated', order, ctx.name)
    return order
end

endpoints['orders:delete'] = function(_, data, ctx)
    local order, index = find(type(data) == 'table' and data.id)
    if not order then return true end
    table.remove(orders, index)
    save()
    changed('deleted', order, ctx.name)
    return true
end

-- ── Printing (computer.print({ data = { id } })) ────────────────────────────────────────────
-- The page names an order; the page that comes out of the printer is built here, from the
-- server's own copy, so what is printed is what the order book says.

local function printOrder(_, data, ctx)
    local order = type(data) == 'table' and find(data.id) or nil
    if not order then return false, 'That work order is gone.' end
    return {
        title = ('Work order #%d'):format(order.id),
        letterhead = 'WRENCHWORKS',
        subhead = ctx.computer.label,
        fields = {
            { label = 'Vehicle', value = ('%s - %s'):format(order.model, order.plate) },
            { label = 'Customer', value = order.customer .. (order.contact and (' <' .. order.contact .. '>') or '') },
            { label = 'Status', value = ({ open = 'Open', progress = 'In progress', done = 'Done' })[order.status] },
            { label = 'Quote', value = ('$%d'):format(order.quote) },
            { label = 'Opened by', value = order.createdBy },
        },
        body = order.work,
        image = order.photo,
        footer = 'Thank you for choosing a Wrenchworks garage.',
    }
end

-- ── Registering the app ─────────────────────────────────────────────────────────────────────

local function register()
    local ok, err = exports['sd-computers']:AddCustomApp({
        id = APP,
        label = 'Wrenchworks',
        ui = RESOURCE .. '/web/index.html',
        icon = RESOURCE .. '/web/icon.svg',
        color = '#f2711c',
        description = 'Work orders for your garage: what is in, what it needs, and what it costs.',
        developer = 'Wrenchworks Software',
        version = '1.0.0',
        size = { w = 1120, h = 720 },
        pinned = true,
        groups = Config.Groups,
        computers = Config.Computers,
        endpoints = endpoints,
        print = printOrder,
        onOpen = function(src, ctx)
            print(('[wrenchworks] %s opened Wrenchworks at %s'):format(ctx.name, ctx.computer.label))
        end,
        onClose = function(src, ctx)
            print(('[wrenchworks] %s closed Wrenchworks'):format(ctx.name or src))
        end,
    })
    if not ok then
        print('[wrenchworks] could not register with sd-computers: ' .. tostring(err))
        return
    end
    exports['sd-computers']:SetAppBadge(-1, APP, openCount())
end

-- sd-computers keeps its apps in memory, so an app registers whenever sd-computers is ready: when
-- it starts (or restarts), and once now in case it was already running before this resource.
AddEventHandler('sd-computers:ready', register)

CreateThread(function()
    if GetResourceState('sd-computers') ~= 'started' then return end
    -- (still starting up, its exports not there yet: the ready event comes in a moment)
    pcall(register)
end)

-- A player who joins later gets the count on their icon too.
AddEventHandler('playerJoining', function()
    exports['sd-computers']:SetAppBadge(source, APP, openCount())
end)

-- /workorder 12: bring the app up on that order (the player must be signed in at a computer with it).
RegisterCommand('workorder', function(src, args)
    if src == 0 then return end
    local id = math.tointeger(tonumber(args[1]))
    local ok, err = exports['sd-computers']:OpenApp(src, APP, id and { order = id } or nil)
    if not ok then
        TriggerClientEvent('chat:addMessage', src, { args = { 'Wrenchworks', err } })
    end
end, false)
