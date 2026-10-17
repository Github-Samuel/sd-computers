-- Wrenchworks, client side: what only the game on this machine knows. The page asks for it with
-- fetchNui (these NUI callbacks are this resource's own, whatever page calls them), and is told
-- when it changes with exports['sd-computers']:SendCustomAppMessage.

local APP = 'wrenchworks'
local BAY_RANGE = 12.0 -- metres from the player a car counts as being in the bay

---The car nearest the player, as the page shows it (nil when there is none in range).
---@return { plate: string, model: string, distance: number }|nil
local function carInBay()
    local here = GetEntityCoords(PlayerPedId())
    local best, bestDist
    for _, veh in ipairs(GetGamePool('CVehicle')) do
        local d = #(GetEntityCoords(veh) - here)
        if d <= BAY_RANGE and (not bestDist or d < bestDist) then
            best, bestDist = veh, d
        end
    end
    if not best then return nil end

    local name = GetDisplayNameFromVehicleModel(GetEntityModel(best))
    local label = GetLabelText(name)
    return {
        plate = (GetVehicleNumberPlateText(best) or ''):gsub('^%s+', ''):gsub('%s+$', ''),
        model = (label ~= 'NULL' and label) or name:sub(1, 1) .. name:sub(2):lower(),
        distance = math.floor(bestDist * 10 + 0.5) / 10,
    }
end

-- The page's "Use the car in the bay" button.
RegisterNUICallback('carInBay', function(_, cb)
    cb(carInBay() or false)
end)

-- While the app is open, tell its page whenever a different car is in the bay. sd-computers says
-- when the app's window opens and closes on this client. Each opening starts a watch of its own,
-- and a watch stops as soon as a newer one has started or the window has closed.
local watch = 0

local function watchBay(mine)
    local last
    while watch == mine and exports['sd-computers']:IsAppOpen(APP) do
        local car = carInBay()
        local key = car and (car.plate .. car.model) or ''
        if key ~= last then
            last = key
            exports['sd-computers']:SendCustomAppMessage(APP, { action = 'bay', data = car or false })
        end
        Wait(1500)
    end
end

AddEventHandler('sd-computers:appOpened', function(id)
    if id ~= APP then return end
    watch = watch + 1
    local mine = watch
    CreateThread(function() watchBay(mine) end)
end)

AddEventHandler('sd-computers:appClosed', function(id)
    if id == APP then watch = watch + 1 end
end)
