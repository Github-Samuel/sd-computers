fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'wrenchworks'
author 'Samuel#0008'
version '1.0.0'
description 'Wrenchworks - work orders for a garage, as a program on sd-computers (an example custom app)'

client_script 'client.lua'
server_script 'server.lua'

-- The app's page, served as https://cfx-nui-wrenchworks/web/... for the computer to frame. There
-- is deliberately no ui_page: that would also lay the page over the game at all times.
files {
    'web/index.html',
    'web/app.css',
    'web/app.js',
    'web/icon.svg',
}

-- No `dependency 'sd-computers'`: restarting sd-computers would stop this resource with it, and
-- nothing starts it again. server.lua registers whenever sd-computers says it is ready instead.
