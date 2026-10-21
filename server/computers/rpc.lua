---@type table Console log helper (shared.log): tagged color-coded prints.
local log = require 'shared.log'
---@type table Session gate (server.computers.session).
local session = require 'server.computers.session'

local ratelimit = require 'server.computers.ratelimit'

---@type table RPC module; the table returned at end of file.
local rpc = {}

---@type table<string, { app: string|nil, fn: function }> Endpoint name -> handler + the app it needs.
local handlers = {}

---Register one app action. Every NUI app call reaches the server through the single
---'sd-computers:server:rpc' callback below, which runs session.guard(src, app) BEFORE the handler -
---so no handler can forget the "signed in, in reach, allowed, app installed" check.
---@param name string endpoint, e.g. 'mail:send'
---@param app string|nil app the caller must have here (nil = any signed-in session)
---@param fn fun(src: integer, s: ComputerSession, payload: table): table handler returning { ok, data?, error? }
function rpc.register(name, app, fn, limit)
    handlers[name] = { app = app, fn = fn, limit = limit }
end

---Shorthand success reply.
---@param data any
---@return table
function rpc.ok(data)
    return { ok = true, data = data }
end

---Shorthand failure reply; `key` is a locale key (extra args format into it).
---@param key string locale key
---@param ... any format args
---@return table
function rpc.fail(key, ...)
    return { ok = false, error = locale(key, ...) }
end

---The one NUI -> server entry point for app actions. Unknown endpoints, a failed guard, or a
---handler that throws all come back as a clean { ok = false, error } - never a hung promise.
---@param src integer
---@param name string endpoint
---@param payload any
lib.callback.register('sd-computers:server:rpc', function(src, name, payload)
    local h = type(name) == 'string' and handlers[name]
    if not h then return rpc.fail('err.invalid') end

    if not ratelimit.bucket(src, 'rpc', 40, 15) then return rpc.fail('err.slow_down') end

    local s, err = session.guard(src, h.app)
    if not s then return { ok = false, error = err } end
    if h.limit and not ratelimit.take(src, 'rpc:' .. name, h.limit) then return rpc.fail('err.slow_down') end

    local ok, res = pcall(h.fn, src, s, type(payload) == 'table' and payload or {})
    if not ok then
        log.error('rpc', '%s failed for src=%s: %s', name, src, tostring(res))
        return rpc.fail('err.internal')
    end
    return res or rpc.ok()
end)

AddEventHandler('playerDropped', function()
    ratelimit.clear(source)
end)

return rpc
