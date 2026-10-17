-- Custom apps: programs other resources put on the desktop with
-- exports['sd-computers']:AddCustomApp({...}) (server side). Each is a web page from that resource,
-- shown in a window of its own with an API to talk to the OS, its own client script and its own
-- server code. examples/wrenchworks is a complete one; the docs have the reference.
-- Nothing here is needed to run one: these are the server owner's limits on them.
return {
    Enabled = true, -- false = no custom app is ever installed, whatever registers one

    -- App ids that are refused even when a resource registers them, e.g. { 'wrenchworks' }.
    Blocked = {},

    MaxApps = 64, -- most custom apps registered at once

    -- What an app keeps with computer.storage: per character (follows them to every computer) or
    -- per machine (everyone who uses that computer sees it). Each app gets this much of each.
    Storage = {
        MaxKeys = 64,
        MaxBytes = 65536, -- every key and value of one app for one character (or one machine), together
    },

    -- How often one player's app may reach its server through computer.callServer, per second.
    -- A call past it is refused with err.slow_down; the app's own endpoints never see it.
    CallsPerSecond = 15,

    -- Event Viewer lines an app may write with computer.log, per player per minute.
    LogsPerMinute = 20,
}
