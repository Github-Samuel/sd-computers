---@type table Rate-limit module; the table returned at end of file.
local ratelimit = {}

---@type table<integer, table<string, integer>> src -> key -> GetGameTimer ms the key frees up at.
local until_ = {}

---Claim `key` for `src` for `seconds`. Returns false (claim refused) while a previous claim on the
---same key is still running, so callers use it as a "not so fast" gate.
---@param src integer player server id
---@param key string action key, e.g. 'mail:send'
---@param seconds number cooldown length
---@return boolean ok true when the action may proceed (and the cooldown is now armed)
function ratelimit.take(src, key, seconds)
    local now = GetGameTimer()
    local mine = until_[src]
    if not mine then mine = {}; until_[src] = mine end
    if mine[key] and mine[key] > now then return false end
    mine[key] = now + math.floor((seconds or 0) * 1000)
    return true
end

local buckets = {}

function ratelimit.bucket(src, key, burst, perSecond)
    local now = GetGameTimer()
    local mine = buckets[src]
    if not mine then mine = {}; buckets[src] = mine end
    local b = mine[key]
    if not b then b = { tokens = burst, at = now }; mine[key] = b end
    b.tokens = math.min(burst, b.tokens + (now - b.at) / 1000 * perSecond)
    b.at = now
    if b.tokens < 1 then return false end
    b.tokens = b.tokens - 1
    return true
end

---Seconds left on `src`'s cooldown for `key` (0 when free).
---@param src integer player server id
---@param key string action key
---@return integer remaining whole seconds
function ratelimit.remaining(src, key)
    local t = until_[src] and until_[src][key]
    if not t then return 0 end
    return math.max(0, math.ceil((t - GetGameTimer()) / 1000))
end

---Forget everything about a player (they dropped).
---@param src integer player server id
function ratelimit.clear(src)
    until_[src] = nil
    buckets[src] = nil
end

return ratelimit
