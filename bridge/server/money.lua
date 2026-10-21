---@type table Detected framework descriptor (bridge.shared.framework).
local framework = require 'bridge.shared.framework'

---@type table Detected inventory resource descriptor (bridge.shared.inventory_id).
local inventoryId = require 'bridge.shared.inventory_id'

---@type table Player resolution helpers (bridge.server.player).
local player_mod = require 'bridge.server.player'

---@type table Tagged debug logger for this file (bridge.shared.debug).
local dprint = require('bridge.shared.debug').tag('bridge:money')

---@type table Money helper module returned to consumers.
local money = {}

dprint('module load — framework: %s, inventoryId: %s', tostring(framework.name), tostring(inventoryId.name))

---Normalises caller-passed money type names across frameworks. ESX wants
---`money` for cash, QBCore wants `cash`; both accept `bank` as-is.
---@param t string
---@return string
local function convertType(t)
    if t == 'money' and framework.name == 'qb'  then return 'cash'  end
    if t == 'cash'  and framework.name == 'esx' then return 'money' end
    return t
end

---Adds money to one of the player's accounts (cash, bank, …).
---@param source number
---@param moneyType string
---@param amount number
---@param reason? string Optional reason string passed to the framework's logger.
function money.add(source, moneyType, amount, reason)
    local converted = convertType(moneyType)
    dprint('add: src=%s moneyType=%s (→%s) amount=%s reason=%s', tostring(source), tostring(moneyType), tostring(converted), tostring(amount), tostring(reason))
    local p = player_mod.get(source)
    if not p then
        dprint('add: player not found for src=%s — aborting', tostring(source))
        return false
    end

    if framework.name == 'qb' then
        dprint('add: calling QBCore AddMoney type=%s amount=%s', tostring(converted), tostring(amount))
        return p.Functions.AddMoney(converted, amount, reason) ~= false
    elseif framework.name == 'esx' then
        dprint('add: calling ESX addAccountMoney type=%s amount=%s', tostring(converted), tostring(amount))
        p.addAccountMoney(converted, amount)
        return true
    else
        dprint('add: unsupported framework %s — no money added', tostring(framework.name))
        return false
    end
end

---Removes money from one of the player's accounts. Returns false when the
---debit could not be applied (unknown player, insufficient balance) so
---callers can use it as an affordability gate — QBCore reports that itself;
---for ESX (whose removeAccountMoney clamps silently) the balance is checked
---first so the semantics match.
---@param source number
---@param moneyType string
---@param amount number
---@param reason? string Optional reason string passed to the framework's logger.
---@return boolean removed true when the full amount was debited
function money.remove(source, moneyType, amount, reason)
    local converted = convertType(moneyType)
    dprint('remove: src=%s moneyType=%s (→%s) amount=%s reason=%s', tostring(source), tostring(moneyType), tostring(converted), tostring(amount), tostring(reason))
    local p = player_mod.get(source)
    if not p then
        dprint('remove: player not found for src=%s — aborting', tostring(source))
        return false
    end

    if framework.name == 'qb' then
        dprint('remove: calling QBCore RemoveMoney type=%s amount=%s', tostring(converted), tostring(amount))
        return p.Functions.RemoveMoney(converted, amount, reason) and true or false
    elseif framework.name == 'esx' then
        local account = p.getAccount(converted)
        if not account or (account.money or 0) < amount then
            dprint('remove: ESX balance too low type=%s have=%s need=%s', tostring(converted), tostring(account and account.money), tostring(amount))
            return false
        end
        dprint('remove: calling ESX removeAccountMoney type=%s amount=%s', tostring(converted), tostring(amount))
        p.removeAccountMoney(converted, amount)
        return true
    end
    dprint('remove: unsupported framework %s — no money removed', tostring(framework.name))
    return false
end

---Reads the player's current balance for one of their accounts.
---@param source number
---@param moneyType string
---@return number
function money.get(source, moneyType)
    local converted = convertType(moneyType)
    dprint('get: src=%s moneyType=%s (→%s)', tostring(source), tostring(moneyType), tostring(converted))
    local p = player_mod.get(source)
    if not p then
        dprint('get: player not found for src=%s — returning 0', tostring(source))
        return 0
    end

    if framework.name == 'qb' then
        local result = p.PlayerData.money[converted] or 0
        dprint('get: QBCore balance type=%s → %d', tostring(converted), result)
        return result
    elseif framework.name == 'esx' then
        local account = p.getAccount(converted)
        local result = account and account.money or 0
        dprint('get: ESX balance type=%s → %d', tostring(converted), result)
        return result
    end
    dprint('get: unsupported framework %s — returning 0', tostring(framework.name))
    return 0
end

---Picks the right "read black-money balance" implementation at module load.
---ox_inventory treats it as a stackable item; qb-inventory walks `markedbills`
---instances and sums their `info.worth`; ESX exposes a real account.
---@return fun(source: number): number
local function chooseGetBlack()
    if inventoryId.name == 'ox_inventory' or inventoryId.name == 'one_inventory' then
        dprint('chooseGetBlack: selected inventory item path (black_money count) for %s', tostring(inventoryId.name))
        local invMod = require 'bridge.server.inventory'
        return function(src)
            local result = invMod.count(src, 'black_money')
            dprint('getBlack: src=%s → %d (via inventory count)', tostring(src), result)
            return result
        end
    end
    if framework.name == 'qb' and inventoryId.name == 'qb-inventory' then
        dprint('chooseGetBlack: selected QBCore markedbills sum path')
        return function(src)
            dprint('getBlack: src=%s — summing markedbills via qb-inventory', tostring(src))
            local bills = exports['qb-inventory']:GetItemsByName(src, 'markedbills')
            if not bills then
                dprint('getBlack: no markedbills found — returning 0')
                return 0
            end
            local worth = 0
            for _, bill in pairs(bills) do
                if bill.info and bill.info.worth then
                    worth = worth + bill.info.worth
                end
            end
            dprint('getBlack: src=%s markedbills total worth=%d', tostring(src), worth)
            return worth
        end
    end
    if framework.name == 'esx' then
        dprint('chooseGetBlack: selected ESX black_money account path')
        return function(src)
            dprint('getBlack: src=%s via ESX getAccount(black_money)', tostring(src))
            local p = player_mod.get(src); if not p then
                dprint('getBlack: player not found for src=%s — returning 0', tostring(src))
                return 0
            end
            local account = p.getAccount('black_money')
            local result = account and account.money or 0
            dprint('getBlack: src=%s → %d', tostring(src), result)
            return result
        end
    end
    dprint('chooseGetBlack: no matching path — returning no-op zero (inventoryId=%s, framework=%s)', tostring(inventoryId.name), tostring(framework.name))
    return function() return 0 end
end

---@type fun(source: number): number Resolved black-money balance reader.
local getBlack = chooseGetBlack()

---Returns the player's current black-money balance.
---@param source number
---@return number
function money.getBlack(source)
    dprint('getBlack: called for src=%s', tostring(source))
    return getBlack(source)
end

---Picks the right "credit black money" implementation at module load.
---@return fun(source: number, amount: number): boolean
local function chooseAddBlack()
    if inventoryId.name == 'ox_inventory' or inventoryId.name == 'one_inventory' then
        dprint('chooseAddBlack: selected inventory item path (black_money add) for %s', tostring(inventoryId.name))
        local invMod = require 'bridge.server.inventory'
        return function(src, amount)
            dprint('addBlack: src=%s amount=%s via inventory.add(black_money)', tostring(src), tostring(amount))
            local result = invMod.add(src, 'black_money', amount)
            dprint('addBlack: result=%s', tostring(result))
            return result
        end
    end
    if framework.name == 'qb' and inventoryId.name == 'qb-inventory' then
        dprint('chooseAddBlack: selected QBCore markedbills AddItem path')
        return function(src, amount)
            dprint('addBlack: src=%s amount=%s — adding markedbills via QBCore', tostring(src), tostring(amount))
            local p = player_mod.get(src); if not p then
                dprint('addBlack: player not found for src=%s — aborting', tostring(src))
                return false
            end
            local result = p.Functions.AddItem('markedbills', 1, false, { worth = amount })
            dprint('addBlack: result=%s', tostring(result))
            return result
        end
    end
    if framework.name == 'esx' then
        dprint('chooseAddBlack: selected ESX black_money account path')
        return function(src, amount)
            dprint('addBlack: src=%s amount=%s via ESX addAccountMoney(black_money)', tostring(src), tostring(amount))
            local p = player_mod.get(src); if not p then
                dprint('addBlack: player not found for src=%s — aborting', tostring(src))
                return false
            end
            p.addAccountMoney('black_money', amount)
            return true
        end
    end
    dprint('chooseAddBlack: no matching path — returning no-op false (inventoryId=%s, framework=%s)', tostring(inventoryId.name), tostring(framework.name))
    return function() return false end
end

---@type fun(source: number, amount: number): boolean Resolved black-money credit function.
local addBlack = chooseAddBlack()

---Adds black money to the player's account.
---@param source number
---@param amount number
---@return boolean
function money.addBlack(source, amount)
    dprint('addBlack: called for src=%s amount=%s', tostring(source), tostring(amount))
    return addBlack(source, amount)
end

---Picks the right "debit black money" implementation at module load. The
---qb-inventory path walks `markedbills` slot-by-slot, partially consuming
---the last bill if the requested amount doesn't divide cleanly.
---@return fun(source: number, amount: number): boolean
local function chooseRemoveBlack()
    if inventoryId.name == 'ox_inventory' or inventoryId.name == 'one_inventory' then
        dprint('chooseRemoveBlack: selected inventory item path (black_money remove) for %s', tostring(inventoryId.name))
        local invMod = require 'bridge.server.inventory'
        return function(src, amount)
            dprint('removeBlack: src=%s amount=%s via inventory.remove(black_money)', tostring(src), tostring(amount))
            local result = invMod.remove(src, 'black_money', amount)
            dprint('removeBlack: result=%s', tostring(result))
            return result
        end
    end
    if framework.name == 'qb' and inventoryId.name == 'qb-inventory' then
        dprint('chooseRemoveBlack: selected QBCore markedbills slot-walk debit path')
        return function(src, amount)
            dprint('removeBlack: src=%s amount=%s — walking markedbills slots', tostring(src), tostring(amount))
            local p = player_mod.get(src); if not p then
                dprint('removeBlack: player not found for src=%s — aborting', tostring(src))
                return false
            end
            local bills = exports['qb-inventory']:GetItemsByName(src, 'markedbills')
            if not bills then
                dprint('removeBlack: no markedbills found for src=%s — returning false', tostring(src))
                return false
            end

            local remaining = amount
            for slot, bill in pairs(bills) do
                if remaining <= 0 then break end
                if bill.info and bill.info.worth then
                    if bill.info.worth <= remaining then
                        dprint('removeBlack: removing full bill worth=%d at slot=%s remaining=%d', bill.info.worth, tostring(slot), remaining)
                        remaining = remaining - bill.info.worth
                        p.Functions.RemoveItem('markedbills', 1, slot)
                    else
                        dprint('removeBlack: partial bill worth=%d debiting=%d at slot=%s', bill.info.worth, remaining, tostring(slot))
                        bill.info.worth = bill.info.worth - remaining
                        remaining = 0
                        p.Functions.SetInventory(p.PlayerData.inventory)
                    end
                end
            end
            local success = remaining == 0
            dprint('removeBlack: src=%s result=%s (remaining=%d)', tostring(src), tostring(success), remaining)
            return success
        end
    end
    if framework.name == 'esx' then
        dprint('chooseRemoveBlack: selected ESX black_money account path')
        return function(src, amount)
            dprint('removeBlack: src=%s amount=%s via ESX removeAccountMoney(black_money)', tostring(src), tostring(amount))
            local p = player_mod.get(src); if not p then
                dprint('removeBlack: player not found for src=%s — aborting', tostring(src))
                return false
            end
            p.removeAccountMoney('black_money', amount)
            return true
        end
    end
    dprint('chooseRemoveBlack: no matching path — returning no-op false (inventoryId=%s, framework=%s)', tostring(inventoryId.name), tostring(framework.name))
    return function() return false end
end

---@type fun(source: number, amount: number): boolean Resolved black-money debit function.
local removeBlack = chooseRemoveBlack()

---Removes black money from the player's account. Returns true only when the
---full amount could be debited.
---@param source number
---@param amount number
---@return boolean
function money.removeBlack(source, amount)
    dprint('removeBlack: called for src=%s amount=%s', tostring(source), tostring(amount))
    return removeBlack(source, amount)
end

return money
