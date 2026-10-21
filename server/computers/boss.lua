---@type table sd-computers config root (configs/config.lua).
local config = require 'configs.config'
---@type table RPC registration (server.computers.rpc).
local rpc = require 'server.computers.rpc'
---@type table Session helpers (server.computers.session).
local session = require 'server.computers.session'
---@type table System Logs writer (server.computers.logs).
local logs = require 'server.computers.logs'
---@type table Job roster adapter (server.computers.employees).
local employees = require 'server.computers.employees'
---@type table Society funds adapter (server.computers.society).
local society = require 'server.computers.society'
---@type table Player resolution helpers (bridge.server.player).
local player = require 'bridge.server.player'
---@type table Money helpers (bridge.server.money).
local money = require 'bridge.server.money'
---@type table Server -> client notify (bridge.server.notify).
local notify = require 'bridge.server.notify'

-- Business Manager. Every endpoint is registered with app 'boss', so session.guard has already
-- confirmed the caller is signed in at a computer that grants them this app AND is still the boss
-- of s.bossJob. The grade rules mirror qbx_management: you can only touch people BELOW your own
-- grade, only move them to grades below your own, and never yourself.

---@type table Boss config (config.Boss).
local B = config.Boss

---Whole-dollar amount in (0, MaxTransfer], or nil.
---@param v any
---@return integer|nil
local function amountOf(v)
    local n = tonumber(v)
    if not n then return nil end
    n = math.floor(n)
    if n <= 0 or n > (B.MaxTransfer or 1000000) then return nil end
    return n
end

---An employee's display name from the roster (their citizenid when not found).
---@param jobName string
---@param cid string
---@return string
local function employeeName(jobName, cid)
    for _, e in ipairs(employees.list(jobName)) do
        if e.cid == cid then return e.name end
    end
    return cid
end

---Write a Business Manager entry to this computer's System Logs.
---@param s ComputerSession
---@param eventId integer
---@param message string
---@param data? table
local function audit(s, eventId, message, data)
    logs.write(s.instance, { level = 'information', source = 'Business', eventId = eventId, message = message, data = data }, session.actor(s))
end

---The overview tab: job + grades, the boss's own grade, roster counts, and (when banking is up)
---the society balance with its recent statement.
rpc.register('boss:overview', 'boss', function(src, s)
    local def = employees.job(s.bossJob)
    if not def then return rpc.fail('err.invalid') end

    local grades = {}
    for level, g in pairs(def.grades) do grades[#grades + 1] = { level = level, name = g.name, isboss = g.isboss } end
    table.sort(grades, function(a, b) return a.level < b.level end)

    local list = employees.list(s.bossJob)
    local online, onDuty = 0, 0
    for _, e in ipairs(list) do
        if e.online then online = online + 1 end
        if e.onDuty then onDuty = onDuty + 1 end
    end

    local funds = { available = society.available() }
    if funds.available then
        funds.balance = society.balance(s.bossJob)
        funds.transactions = society.transactions(s.bossJob, B.TransactionLimit or 50)
        funds.depositFrom = B.DepositFrom or { 'bank' }
        funds.withdrawTo = B.WithdrawTo or 'bank'
        funds.max = B.MaxTransfer or 1000000
    end

    return rpc.ok({
        job = { name = def.name, label = def.label },
        grades = grades,
        myGrade = employees.gradeOf(src),
        myCid = s.citizenid,
        hireById = B.HireById ~= false,
        counts = { total = #list, online = online, onDuty = onDuty },
        funds = funds,
    })
end)

---The roster: { cid, name, grade, gradeName, online, onDuty }.
rpc.register('boss:employees', 'boss', function(_, s)
    local def = employees.job(s.bossJob)
    local list = employees.list(s.bossJob)
    for _, e in ipairs(list) do
        local g = def and def.grades[e.grade]
        e.gradeName = g and g.name or tostring(e.grade)
    end
    return rpc.ok(list)
end)

---Promote/demote. Refused for yourself, for anyone at or above your grade, and for any target
---grade at or above yours (or that the job doesn't have).
---@param payload { cid: string, grade: integer }
rpc.register('boss:setGrade', 'boss', function(src, s, payload)
    local cid, grade = payload.cid, math.tointeger(tonumber(payload.grade))
    if type(cid) ~= 'string' or not grade then return rpc.fail('err.invalid') end
    if cid == s.citizenid then return rpc.fail('boss.err_self') end

    local def = employees.job(s.bossJob)
    if not def or not def.grades[grade] then return rpc.fail('err.invalid') end
    local mine = employees.gradeOf(src)
    local current = employees.gradeIn(cid, s.bossJob)
    if current == nil then return rpc.fail('boss.err_not_employee') end
    if current >= mine or grade >= mine then return rpc.fail('boss.err_rank') end
    if current == grade then return rpc.ok() end

    local ok, err = employees.setGrade(cid, s.bossJob, grade)
    if not ok then return rpc.fail('boss.err_failed', err or '?') end

    local who = employeeName(s.bossJob, cid)
    audit(s, logs.EVENT.BOSS_GRADE, locale('logs.boss_grade', s.name, who, def.grades[current] and def.grades[current].name or current, def.grades[grade].name), { cid = cid, from = current, to = grade })
    local target = employees.sourceOf(cid)
    if target then notify.to(target, { title = def.label, description = locale('boss.notify_grade', def.grades[grade].name), type = 'inform' }) end
    return rpc.ok()
end, 1)

---Fire someone below your grade (online or offline).
---@param payload { cid: string }
rpc.register('boss:fire', 'boss', function(src, s, payload)
    local cid = payload.cid
    if type(cid) ~= 'string' then return rpc.fail('err.invalid') end
    if cid == s.citizenid then return rpc.fail('boss.err_self') end

    local current = employees.gradeIn(cid, s.bossJob)
    if current == nil then return rpc.fail('boss.err_not_employee') end
    if current >= employees.gradeOf(src) then return rpc.fail('boss.err_rank') end

    local name = employeeName(s.bossJob, cid)
    local target = employees.sourceOf(cid)

    local ok, err = employees.fire(cid, s.bossJob)
    if not ok then return rpc.fail('boss.err_failed', err or '?') end

    local def = employees.job(s.bossJob)
    audit(s, logs.EVENT.BOSS_FIRE, locale('logs.boss_fire', s.name, name, def and def.label or s.bossJob), { cid = cid })
    if target then notify.to(target, { title = def and def.label or s.bossJob, description = locale('boss.notify_fired'), type = 'error' }) end
    return rpc.ok()
end, 1)

---Players near the COMPUTER who could be hired (not yourself, not already in this job).
rpc.register('boss:nearby', 'boss', function(src, s)
    local out = {}
    local radius = B.HireRadius or 10.0
    for _, id in ipairs(GetPlayers()) do
        local target = tonumber(id)
        if target and target ~= src then
            local ped = GetPlayerPed(target)
            if ped ~= 0 and #(GetEntityCoords(ped) - s.coords) <= radius then
                local p = player.get(target)
                local j = p and p.PlayerData and p.PlayerData.job
                if p and not (j and j.name == s.bossJob) then
                    out[#out + 1] = { id = target, name = player.getName(target) }
                end
            end
        end
    end
    table.sort(out, function(a, b) return a.name < b.name end)
    return rpc.ok(out)
end)

---@type table<integer, boolean> Players with a job offer on their screen. One at a time each,
---whoever sent it: an offer can reach anyone online, and prompts must not pile up on them.
local offered = {}

---Offer a player the job: one standing at the computer, or - with `byId`, where config.Boss.HireById
---allows it - anyone online, by their server id. They get a confirm prompt; only an accept hires them.
---@param payload { id: integer, byId?: boolean }
rpc.register('boss:hire', 'boss', function(src, s, payload)
    local target = math.tointeger(tonumber(payload.id))
    if payload.byId == true then
        if B.HireById == false or not target or target < 1 then return rpc.fail('err.invalid') end
        if target == src then return rpc.fail('boss.err_self') end
        if not player.get(target) then return rpc.fail('boss.err_no_player', target) end
    else
        if not target or target == src or not player.get(target) then return rpc.fail('boss.err_not_around') end
        local ped = GetPlayerPed(target)
        if ped == 0 or #(GetEntityCoords(ped) - s.coords) > (B.HireRadius or 10.0) then return rpc.fail('boss.err_not_around') end
    end
    local p = player.get(target)
    local j = p and p.PlayerData and p.PlayerData.job
    if j and j.name == s.bossJob then return rpc.fail('boss.err_already') end
    if offered[target] then return rpc.fail('boss.err_offer_open') end

    local def = employees.job(s.bossJob)
    if not def then return rpc.fail('err.invalid') end
    -- (whatever becomes of the prompt - an answer, the 20 seconds running out, the player leaving -
    -- they are free to be offered a job again)
    offered[target] = true
    local answered, accepted = pcall(lib.callback.await, 'sd-computers:client:confirmHire', target, s.name, def.label)
    offered[target] = nil
    if not answered or accepted ~= true then return rpc.fail('boss.err_declined') end

    local ok, err = employees.hire(target, s.bossJob)
    if not ok then return rpc.fail('boss.err_failed', err or '?') end

    local name = player.getName(target)
    audit(s, logs.EVENT.BOSS_HIRE, locale('logs.boss_hire', s.name, name, def.label), { cid = player.getIdentifier(target), byId = payload.byId == true or nil })
    notify.to(target, { title = def.label, description = locale('boss.notify_hired', def.label), type = 'success' })
    return rpc.ok({ name = name })
end, 1)

---Move the boss's own money into the society. Debit first (it's the step that can fail on
---insufficient funds); if the society credit then fails, the debit is refunded.
---@param payload { amount: number, from: string }
rpc.register('boss:deposit', 'boss', function(src, s, payload)
    if not society.available() then return rpc.fail('boss.err_no_banking') end
    local amount = amountOf(payload.amount)
    if not amount then return rpc.fail('boss.err_amount') end
    local from = payload.from
    local allowed = false
    for _, f in ipairs(B.DepositFrom or { 'bank' }) do if f == from then allowed = true end end
    if not allowed then return rpc.fail('err.invalid') end

    local def = employees.job(s.bossJob)
    local label = def and def.label or s.bossJob
    if not money.remove(src, from, amount, 'sd-computers-society-deposit') then return rpc.fail('boss.err_broke') end
    if not society.deposit(s.bossJob, amount, s.name, label) then
        money.add(src, from, amount, 'sd-computers-society-refund')
        return rpc.fail('boss.err_no_account')
    end
    audit(s, logs.EVENT.BOSS_DEPOSIT, locale('logs.boss_deposit', s.name, amount, label), { amount = amount, from = from })
    return rpc.ok({ balance = society.balance(s.bossJob) })
end, 1)

---Move society money to the boss. The society debit is refused outright when it can't cover it.
---@param payload { amount: number }
rpc.register('boss:withdraw', 'boss', function(src, s, payload)
    if not society.available() then return rpc.fail('boss.err_no_banking') end
    local amount = amountOf(payload.amount)
    if not amount then return rpc.fail('boss.err_amount') end

    local def = employees.job(s.bossJob)
    local label = def and def.label or s.bossJob
    if not society.withdraw(s.bossJob, amount, s.name, label) then return rpc.fail('boss.err_society_broke') end
    if not money.add(src, B.WithdrawTo or 'bank', amount, 'sd-computers-society-withdraw') then
        society.deposit(s.bossJob, amount, s.name, label)
        return rpc.fail('boss.err_failed', '?')
    end
    audit(s, logs.EVENT.BOSS_WITHDRAW, locale('logs.boss_withdraw', s.name, amount, label), { amount = amount })
    return rpc.ok({ balance = society.balance(s.bossJob) })
end, 1)

return {}
