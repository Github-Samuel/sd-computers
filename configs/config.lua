-- Aggregate config root, loaded by both sides via `require 'configs.config'`.
-- Scope-by-folder: configs/shared/ is read by client + server, configs/client/ is client-only,
-- and configs/server/ holds the sensitive data - excluded from fxmanifest files{}, so it never
-- ships to a client. The server-only files are deep-merged below on the server ONLY.
local config = {
    Locale = 'en', -- lib.locale loads locales/<Locale>.json, falling back to en per-key
    Debug = false, -- dev logging (cyan [sd-computers:*] console lines); leave off in production

    -- Bridge diagnostics (bridge/shared/debug.lua): very verbose per-call prints from the
    -- framework/inventory/target bridge. Separate from Debug above so gameplay debugging
    -- doesn't drown in bridge traffic. DebugCategories filters by tag when set, e.g.
    -- { ['bridge:target'] = true } prints only that category.
    DebugPrints = false,
    -- DebugCategories = { ['bridge:target'] = true },

    -- Shared (client + server)
    Computers = require 'configs.shared.computers', -- every usable computer: a location OR a prop model, its apps + job lock
    Desktop = require 'configs.shared.desktop', -- the OS itself: app registry, pinned apps, wallpapers, accent, clock
    Mail = require 'configs.shared.mail', -- mail domain + compose limits the UI enforces too (rate limits are server-only)
    Hacks = require 'configs.shared.hacks', -- minigame catalogue + easy/medium/hard difficulty presets
    Boss = require 'configs.shared.boss', -- Business Manager toggles (hire radius, money sources)
    Phone = require 'configs.shared.phone', -- optional sd-phone link: phone mail, Messages, Notes + Contacts apps, the phone's gallery and documents (inert without sd-phone)
    Files = require 'configs.shared.files', -- Files: how many documents a character keeps, and how long
    Board = require 'configs.shared.board', -- Company Board: a job's announcements + who is on duty
    Bank = require 'configs.shared.bank', -- Bank: balance + statement (read-only)
    Browser = require 'configs.shared.browser', -- Browser: the sites a computer can open
    Cameras = require 'configs.shared.cameras', -- Security Cameras: where they are and who may watch them
    Photos = require 'configs.shared.photos', -- Photos: the character's pictures on every computer, and the hosts one may be linked from
    Printers = require 'configs.shared.printers', -- Printers: the props a printer can be, how far one reaches, the item a printout is
    Interact = require 'configs.shared.interact', -- target label/icon/distance, typing animation, walk-away distance (server re-checks it)
    Admin = require 'configs.shared.admin', -- the /computeradmin panel: who may use it, the placement gizmo, the props a computer can be placed as
    Screens = require 'configs.shared.screens', -- the screen drawn on a computer's prop: lock face when idle, a live copy of the session when in use
    Apps = require 'configs.shared.apps', -- custom apps other resources put on the desktop: the server owner's limits on them
}

-- Server-only (sensitive): computer PINs, hack targets + their rewards, banking backend, log
-- retention and the mail rate limits. Merged in server-side only.
if IsDuplicityVersion() then
    local function merge(dst, src)
        for k, v in pairs(src) do
            if type(v) == 'table' and type(dst[k]) == 'table' then merge(dst[k], v) else dst[k] = v end
        end
    end
    merge(config.Mail, require 'configs.server.mail')
    merge(config.Boss, require 'configs.server.boss')
    merge(config.Hacks, require 'configs.server.hacks')

    config.Security = require 'configs.server.security' -- per-computer PINs + sign-in lockout (no client half)
    config.Targets = require 'configs.server.targets' -- breachable hack targets + rewards: sensitive, no client half
    config.Logs = require 'configs.server.logs' -- System Logs retention + which events get written
end

return config
