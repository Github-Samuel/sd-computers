---@type table sd-computers config root (configs/config.lua).
local config = require 'configs.config'
---@type table RPC registration (server.computers.rpc).
local rpc = require 'server.computers.rpc'
---@type table Optional sd-phone link (server.computers.phone).
local phone = require 'server.computers.phone'
---@type table UTF-8-safe clipping (shared.text).
local text = require 'shared.text'
---@type table Rich documents (server.computers.richdoc): what a formatted document may hold.
local richdoc = require 'server.computers.richdoc'
---@type table Photos (server.computers.photos): which pictures a document of this player may hold.
local photos = require 'server.computers.photos'
---@type table Printing (server.computers.printing): a document can be printed.
local printing = require 'server.computers.printing'
---@type table Player bridge (bridge.server.player): whose documents a server id's are (AddFile).
local player = require 'bridge.server.player'

-- Files: the character's documents. A document is a name and a body, kept in computers_files
-- under the character's citizenid, so what is written on one computer is there on every other
-- one. The body is either plain text (`format` 'text': what a document was before it could be
-- formatted, and what one copied from the phone is) or a formatted document as JSON ('rich':
-- server/computers/richdoc.lua - a typeface, and blocks of text, lists and pictures). Every query
-- names the session's own citizenid: a row id sent by the NUI is never enough to reach somebody
-- else's document.
--
-- With sd-phone linked, the phone's own documents show as a second place. They are read through
-- sd-phone's plain exports (its server/documents/init.lua), which work out the owner from the
-- player's server id themselves. The desk only reads them and copies text either way: sd-phone has
-- no export that edits a document, and the one that deletes skips the phone's "locked" and "cannot
-- be deleted" guards, so neither is offered here. Phone data is personal, so nothing in this file
-- writes to the System Logs.

---@type table Files config (configs/shared/files.lua).
local F = config.Files or {}
---@type table Phone link config (configs/shared/phone.lua).
local P = config.Phone or {}

---@type integer Documents one character may keep.
local MAX_FILES = math.max(1, math.floor(tonumber(F.MaxFiles) or 100))
---@type integer Characters in a file name (the column holds 255).
local MAX_NAME = math.min(255, math.max(8, math.floor(tonumber(F.MaxName) or 80)))
---@type integer Characters in a document.
local MAX_BODY = math.max(1, math.floor(tonumber(F.MaxBody) or 20000))
---@type integer Bytes sd-phone keeps of a document's name (its MaxNameLength).
local PHONE_NAME = 60

---@type string The columns of a document without its text: what the list and every write reply carry.
local META = 'id, name, size, UNIX_TIMESTAMP(created_at) AS createdAt, UNIX_TIMESTAMP(updated_at) AS updatedAt'

---@type table<string, boolean> The kinds of document sd-phone keeps.
local KINDS = { text = true, image = true, file = true }

---@type table Files module; the table returned at end of file.
local files = {}

---@class FileRow
---@field id integer
---@field name string
---@field size integer bytes of text
---@field createdAt integer unix seconds
---@field updatedAt integer unix seconds: when the text last changed (a rename leaves it alone)

---Create the table if it doesn't exist, so the resource stays drop-in. Run once at boot.
function files.ensureSchema()
    MySQL.query.await([[
        CREATE TABLE IF NOT EXISTS computers_files (
            id         INT          NOT NULL AUTO_INCREMENT,
            citizenid  VARCHAR(64)  NOT NULL,
            name       VARCHAR(255) NOT NULL,
            body       MEDIUMTEXT   NOT NULL,
            size       INT          NOT NULL DEFAULT 0,
            created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_citizen (citizenid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ]])
    -- (a table made before documents could be formatted has no `format` column yet)
    local has = MySQL.query.await("SHOW COLUMNS FROM computers_files LIKE 'format'")
    if not has or #has == 0 then
        MySQL.query.await("ALTER TABLE computers_files ADD COLUMN format VARCHAR(8) NOT NULL DEFAULT 'text' AFTER body")
    end
end

---A stored body as the formatted document it is (nil for plain text, or one that will not read).
---@param body string|nil
---@param format string|nil
---@return RichDoc|nil
local function richOf(body, format)
    if format ~= 'rich' or type(body) ~= 'string' then return nil end
    local ok, raw = pcall(json.decode, body)
    if not ok then return nil end
    return (richdoc.clean(raw, math.huge))
end

-- ── Rows ──────────────────────────────────────────────────────────────────────────────────

---A stored row as the NUI gets it.
---@param r table computers_files row read with META
---@return FileRow
local function shape(r)
    return {
        id = r.id, name = r.name, size = tonumber(r.size) or 0,
        createdAt = tonumber(r.createdAt) or 0, updatedAt = tonumber(r.updatedAt) or 0,
    }
end

---A character's documents without their text, most recently changed first.
---@param citizenid string
---@return FileRow[]
local function listOf(citizenid)
    local rows = MySQL.query.await('SELECT ' .. META .. ' FROM computers_files WHERE citizenid = ? ORDER BY updated_at DESC, id DESC', { citizenid }) --[[@as table[]?]]
    local out = {}
    for _, r in ipairs(rows or {}) do out[#out + 1] = shape(r) end
    return out
end

---One of a character's documents without its text (nil when it isn't theirs or is gone).
---@param citizenid string
---@param id integer
---@return FileRow|nil
local function metaOf(citizenid, id)
    local r = MySQL.single.await('SELECT ' .. META .. ' FROM computers_files WHERE id = ? AND citizenid = ?', { id, citizenid })
    return r and shape(r) or nil
end

---The ids and names of a character's documents: how many there are, and which names are taken.
---@param citizenid string
---@return { id: integer, name: string }[]
local function namesOf(citizenid)
    return MySQL.query.await('SELECT id, name FROM computers_files WHERE citizenid = ?', { citizenid }) or {}
end

---Whether one of those documents is `id`.
---@param list { id: integer, name: string }[]
---@param id integer
---@return boolean
local function owns(list, id)
    for _, r in ipairs(list) do
        if r.id == id then return true end
    end
    return false
end

---Whether another of those documents already has this name. Names differing only in case count
---as the same one, as they would on a real disk.
---@param list { id: integer, name: string }[]
---@param name string
---@param exceptId? integer the document being saved or renamed
---@return boolean
local function taken(list, name, exceptId)
    local lower = name:lower()
    for _, r in ipairs(list) do
        if r.id ~= exceptId and type(r.name) == 'string' and r.name:lower() == lower then return true end
    end
    return false
end

-- ── Input ─────────────────────────────────────────────────────────────────────────────────

---A row id off the wire: a positive whole number, or nil.
---@param v any
---@return integer|nil
local function idOf(v)
    local n = tonumber(v)
    n = n and math.tointeger(n)
    return n and n > 0 and n or nil
end

---A file name as it is stored: one line, trimmed, at most MaxName characters ('' = nothing usable).
---@param v any
---@return string
local function cleanName(v)
    if type(v) ~= 'string' then return '' end
    return text.trim(text.clip(text.trim((v:gsub('%c', ' '))), MAX_NAME))
end

---How many characters a string is (bytes, when it isn't valid UTF-8).
---@param s string
---@return integer
local function chars(s)
    return utf8.len(s) or #s
end

---Clip to at most `max` BYTES without cutting a UTF-8 sequence in half.
---@param s string
---@param max integer
---@return string
local function clipBytes(s, max)
    if #s <= max then return s end
    local cut = max
    -- Step back while the byte after the cut is a continuation byte: that character doesn't fit.
    while cut > 0 and (s:byte(cut + 1) & 0xC0) == 0x80 do cut = cut - 1 end
    return text.trim(s:sub(1, cut))
end

---A name no other of those documents has: `base` itself, else "base (2)", "base (3)" ...
---@param list { id: integer, name: string }[]
---@param base string
---@return string
local function freeName(list, base)
    if base == '' then base = locale('files.untitled') end
    if not taken(list, base) then return base end
    for n = 2, #list + 2 do
        local suffix = (' (%d)'):format(n)
        local name = text.trim(text.clip(base, MAX_NAME - #suffix)) .. suffix
        if not taken(list, name) then return name end
    end
    return base
end

-- ── Documents ─────────────────────────────────────────────────────────────────────────────

---Whether this session shows the phone's documents: sd-phone linked, Phone.Files on, a computer
---that hasn't opted out of the phone (`phone = false`), the phone linked to this machine in Phone
---Link (with RequireLink) and - with RequirePhone - a phone carried. The same rule the phone apps
---are installed by.
---@param src integer
---@param s ComputerSession
---@return boolean
local function phoneSide(src, s)
    if P.Files == false or s.def.phone == false or not phone.linked() then return false end
    return phone.unlocked(src, s.citizenid, s.instance)
end

---The character's documents (no text), whether the phone's place is there at all, and the limits
---the editor counts against.
rpc.register('files:list', 'files', function(src, s)
    return rpc.ok({
        files = listOf(s.citizenid),
        phone = phoneSide(src, s),
        limits = { maxFiles = MAX_FILES, maxName = MAX_NAME, maxBody = MAX_BODY },
    })
end)

---One document with its text.
---@param p { id: integer }
rpc.register('files:read', 'files', function(_, s, p)
    local id = idOf(p.id)
    if not id then return rpc.fail('err.invalid') end
    local r = MySQL.single.await('SELECT ' .. META .. ', body, format FROM computers_files WHERE id = ? AND citizenid = ?', { id, s.citizenid })
    if not r then return rpc.fail('files.missing') end
    local out = shape(r)
    out.body = r.body or ''
    out.format = r.format == 'rich' and 'rich' or 'text'
    return rpc.ok(out)
end)

---Create or update a document. No id is a new one, and so is an id that is gone (deleted from the
---database while it was open): the text on screen is kept rather than refused.
---`format` 'rich' = `body` is a formatted document as JSON (server/computers/richdoc.lua): it is cut
---down to what a document can be, and a picture in it has to be one out of the player's gallery.
---@param p { id?: integer, name: string, body: string, format?: 'text'|'rich' }
rpc.register('files:save', 'files', function(src, s, p)
    local id = idOf(p.id)
    if p.id ~= nil and not id then return rpc.fail('err.invalid') end
    local name = cleanName(p.name)
    if name == '' then return rpc.fail('files.name_required') end

    local list = namesOf(s.citizenid)
    if id and not owns(list, id) then id = nil end
    if taken(list, name, id) then return rpc.fail('files.name_taken', name) end

    local body, format = '', 'text'
    if p.format == 'rich' then
        local ok, raw = pcall(json.decode, type(p.body) == 'string' and #p.body <= 400000 and p.body or '')
        -- (one character over the limit is read, so that a document too long is refused and not cut short)
        local doc, stats = richdoc.clean(ok and raw or nil, MAX_BODY + 1)
        if not doc then return rpc.fail('err.invalid') end
        if stats.chars > MAX_BODY then return rpc.fail('files.too_long', MAX_BODY) end
        -- The pictures the stored document has may stay, whatever has become of the gallery since.
        local kept = {}
        if id and #stats.images > 0 then
            local old = MySQL.single.await('SELECT body, format FROM computers_files WHERE id = ? AND citizenid = ?', { id, s.citizenid })
            local was = old and richOf(old.body, old.format)
            if was then
                for _, url in ipairs(select(2, richdoc.clean(was, math.huge)).images) do kept[url] = true end
            end
        end
        if not photos.allowed(src, s, stats.images, kept) then return rpc.fail('files.picture_unknown') end
        body, format = json.encode(doc), 'rich'
    else
        body = text.clip(type(p.body) == 'string' and p.body or '', MAX_BODY)
    end

    if id then
        MySQL.update.await('UPDATE computers_files SET name = ?, body = ?, format = ?, size = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND citizenid = ?',
            { name, body, format, #body, id, s.citizenid })
    else
        if #list >= MAX_FILES then return rpc.fail('files.full', MAX_FILES) end
        id = MySQL.insert.await('INSERT INTO computers_files (citizenid, name, body, format, size) VALUES (?, ?, ?, ?, ?)', { s.citizenid, name, body, format, #body })
    end

    local row = id and metaOf(s.citizenid, id)
    if not row then return rpc.fail('err.internal') end
    return rpc.ok(row)
end)

---Rename a document. Its modified time stays: that is when the text last changed.
---@param p { id: integer, name: string }
rpc.register('files:rename', 'files', function(_, s, p)
    local id = idOf(p.id)
    if not id then return rpc.fail('err.invalid') end
    local name = cleanName(p.name)
    if name == '' then return rpc.fail('files.name_required') end

    local list = namesOf(s.citizenid)
    if not owns(list, id) then return rpc.fail('files.missing') end
    if taken(list, name, id) then return rpc.fail('files.name_taken', name) end

    MySQL.update.await('UPDATE computers_files SET name = ? WHERE id = ? AND citizenid = ?', { name, id, s.citizenid })
    local row = metaOf(s.citizenid, id)
    if not row then return rpc.fail('files.missing') end
    return rpc.ok(row)
end)

---Delete a document (a no-op for one that is already gone).
---@param p { id: integer }
rpc.register('files:delete', 'files', function(_, s, p)
    local id = idOf(p.id)
    if not id then return rpc.fail('err.invalid') end
    MySQL.query.await('DELETE FROM computers_files WHERE id = ? AND citizenid = ?', { id, s.citizenid })
    return rpc.ok()
end)

-- A document as a printed page: the stored one, read here, so what prints is what was saved. A
-- formatted document prints as it is set; one that is still plain text prints as a typed page.
---@param p { id: integer }
printing.source('file', 'files', function(_, s, p)
    local id = idOf(p.id)
    if not id then return nil, locale('err.invalid') end
    local r = MySQL.single.await('SELECT name, body, format FROM computers_files WHERE id = ? AND citizenid = ?', { id, s.citizenid })
    if not r then return nil, locale('files.missing') end
    local doc = richOf(r.body, r.format)
    if doc then return { kind = 'document', title = r.name, rich = doc } end
    return { kind = 'text', title = r.name, body = r.body or '' }
end)

-- ── Phone ─────────────────────────────────────────────────────────────────────────────────

---Register an endpoint of the phone's place: refused cleanly when the link dropped, the phone was
---put away or Phone.Files was switched off since the list said the place was there.
---@param name string endpoint
---@param fn fun(src: integer, s: ComputerSession, p: table): table
local function registerPhone(name, fn)
    rpc.register(name, 'files', function(src, s, p)
        if not phoneSide(src, s) then return rpc.fail('err.phone_unavailable') end
        return fn(src, s, p)
    end)
end

---A phone document, trimmed to what the desk draws. `locked` = read-only on the phone as well (a
---lease, a receipt: something another resource issued).
---@param d table sd-phone document (getPlayerDocuments row)
---@return table
local function phoneRow(d)
    return {
        id = d.id, name = type(d.name) == 'string' and d.name or '', kind = KINDS[d.kind] and d.kind or 'file',
        size = tonumber(d.size) or 0, locked = d.locked == true,
        createdAt = tonumber(d.createdAt) or 0, updatedAt = tonumber(d.updatedAt) or 0,
    }
end

---One of the player's phone documents by id. sd-phone has no export for a single row, so this
---reads the list (it carries no text) and picks it out.
---@param src integer
---@param id any
---@return table|nil doc sd-phone document
---@return string|nil err locale key when there is none
local function phoneDoc(src, id)
    if type(id) ~= 'string' or id == '' then return nil, 'err.invalid' end
    local docs = phone.export('getPlayerDocuments', src)
    if type(docs) ~= 'table' then return nil, 'err.phone_unavailable' end
    for _, d in ipairs(docs) do
        if type(d) == 'table' and d.id == id then return d, nil end
    end
    return nil, 'files.phone_missing'
end

---Every document on the phone (no text), most recently changed first. Folders are the phone's
---own business: the exports don't name them, so the desk shows one flat list.
registerPhone('files:phoneList', function(src)
    local docs = phone.export('getPlayerDocuments', src)
    if type(docs) ~= 'table' then return rpc.fail('err.phone_unavailable') end
    local out = {}
    for _, d in ipairs(docs) do
        if type(d) == 'table' and type(d.id) == 'string' then out[#out + 1] = phoneRow(d) end
    end
    return rpc.ok({ files = out })
end)

---One phone document to look at: its text (a picture has none, an attachment may not), a picture's
---address, and who signed it. Signature drawings stay on the phone - the desk names the signers.
---@param p { id: string }
registerPhone('files:phoneRead', function(src, _, p)
    local d, err = phoneDoc(src, p.id)
    if not d then return rpc.fail(err or 'err.invalid') end

    local out = phoneRow(d)
    local content = phone.export('getDocumentContent', src, d.id)
    out.body = type(content) == 'string' and content or ''
    if out.kind == 'image' and type(d.url) == 'string' and d.url:match('^https?://') then out.url = d.url end

    local signatures = {}
    if out.kind == 'text' then
        local list = phone.export('getDocumentSignatures', src, d.id)
        for _, sig in ipairs(type(list) == 'table' and list or {}) do
            if type(sig) == 'table' then
                signatures[#signatures + 1] = { signer = tostring(sig.signer or ''), signedAt = tonumber(sig.signedAt) or 0 }
            end
        end
    end
    out.signatures = signatures
    return rpc.ok(out)
end)

---Copy one of the character's documents onto the phone as a new text document. The phone gives
---no reason through the link when it refuses (too long for it, or its own document limit).
---@param p { id: integer }
registerPhone('files:toPhone', function(src, s, p)
    local id = idOf(p.id)
    if not id then return rpc.fail('err.invalid') end
    local r = MySQL.single.await('SELECT name, body, format FROM computers_files WHERE id = ? AND citizenid = ?', { id, s.citizenid })
    if not r then return rpc.fail('files.missing') end
    -- (the phone keeps text: a formatted document goes over as its words, without its pictures)
    local rich = richOf(r.body, r.format)
    local content = rich and richdoc.text(rich) or r.body or ''

    -- The phone cuts a long name itself, but by bytes: a name clipped here can't end mid-character.
    -- notify = false: the player is looking at the desk's own "copied" message, not at the phone.
    local docId = phone.export('createDocument', src, {
        name = clipBytes(r.name, PHONE_NAME), kind = 'text', content = content, notify = false,
    })
    if type(docId) ~= 'string' then return rpc.fail('files.phone_refused') end
    return rpc.ok({ id = docId })
end)

---Save a copy of a phone document's text to the character's documents. A document too long to
---keep whole is refused rather than cut short, and a name already in use gets a number after it.
---@param p { id: string }
registerPhone('files:fromPhone', function(src, s, p)
    local d, err = phoneDoc(src, p.id)
    if not d then return rpc.fail(err or 'err.invalid') end

    local content = phone.export('getDocumentContent', src, d.id)
    if type(content) ~= 'string' or content == '' then return rpc.fail('files.phone_no_text') end
    if chars(content) > MAX_BODY then return rpc.fail('files.too_long', MAX_BODY) end

    local list = namesOf(s.citizenid)
    if #list >= MAX_FILES then return rpc.fail('files.full', MAX_FILES) end
    local name = freeName(list, cleanName(d.name))
    local id = MySQL.insert.await('INSERT INTO computers_files (citizenid, name, body, size) VALUES (?, ?, ?, ?)', { s.citizenid, name, content, #content })

    local row = id and metaOf(s.citizenid, id)
    if not row then return rpc.fail('err.internal') end
    return rpc.ok(row)
end)

---Export: put a plain-text document into a character's Files - heist intel, a report, a letter. A
---name already in use gets a number after it; text over MaxBody is cut short.
---@param target string|integer a citizenid, or an online player's server id
---@param file { name?: string, body: string }
---@return integer|false id
---@return string nameOrWhy the name it was saved under, or why not: 'no_character', 'bad_file', 'full', 'failed'
exports('AddFile', function(target, file)
    local citizenid = target
    if type(target) == 'number' then citizenid = player.getIdentifier(target) end
    if type(citizenid) ~= 'string' or citizenid == '' then return false, 'no_character' end
    if type(file) ~= 'table' or type(file.body) ~= 'string' then return false, 'bad_file' end

    local list = namesOf(citizenid)
    if #list >= MAX_FILES then return false, 'full' end
    local name = freeName(list, cleanName(file.name))
    local body = text.clip(file.body, MAX_BODY)
    local id = MySQL.insert.await('INSERT INTO computers_files (citizenid, name, body, size) VALUES (?, ?, ?, ?)', { citizenid, name, body, #body })
    if not id then return false, 'failed' end
    return id, name
end)

return files
