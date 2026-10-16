fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'sd-computers'
author 'Samuel#0008'
version '1.0.1'
description 'Computers - SD OS, a full desktop for any location or prop: mail, System Logs, Command Prompt hacking and a Business Manager'

shared_scripts {
    '@ox_lib/init.lua',
    'bridge/shared/init.lua',
}

client_scripts {
    'bridge/client/init.lua',
    'client/main.lua',
}

server_scripts {
    '@oxmysql/lib/MySQL.lua',
    'bridge/server/init.lua',
    'server/main.lua',
}

ui_page 'web/build/index.html'

-- Client-readable files for ox_lib's require. `dir/**.lua` does NOT match files sitting directly
-- in `dir`, so every folder is listed in both forms. configs/server/ is deliberately absent: those
-- files (PINs, hack rewards, banking backend) are read server-side only and never ship.
files {
    'bridge/*.lua',
    'bridge/**.lua',
    'shared/*.lua',
    'shared/**.lua',
    'configs/config.lua',
    'configs/shared/*.lua',
    'client/*.lua',
    'client/**.lua',
    'locales/*.json',
    'web/build/index.html', -- the NUI page: holds the two below as frames
    'web/build/os.html', -- the OS itself (a frame, so it can sit on a prop's screen with a window of its own)
    'web/build/admin.html', -- the /computeradmin panel
    'web/build/screen.html', -- what a computer's prop shows in the world: the page behind every screen (client/screens)
    'web/build/assets/*.js',
    'web/build/assets/*.css',
    'web/build/assets/*.woff2', -- bundled open-licence fonts (Inter, JetBrains Mono)
    'web/build/props/*.jpg', -- what each placeable prop looks like, for the admin panel (web/public/props)
}

-- Framework (qb-core/qbx_core or es_extended), inventory and target (ox_target, qb-target,
-- qtarget) are detected at runtime by the bridge. The Business Manager uses qbx_core / qb-core
-- and, for society funds, sd-banking or Renewed-Banking when running.
dependencies {
    'ox_lib',
    'oxmysql',
}
