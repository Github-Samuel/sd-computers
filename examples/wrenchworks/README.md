# Wrenchworks

A garage's work-order book, as a program on [sd-computers](../../README.md). It is the example custom app: it uses every part of the API, each where a real program would, so it doubles as a template. The reference for everything it calls is [Custom apps in the docs](https://docs.samueldev.shop/resources/computers/custom-apps).

![Wrenchworks on the modern look](../../docs/previews/custom-apps.webp)

Mechanics file an order for the car in the bay, start it, mark it done, set a quote, attach a photo, print it for the customer and email them. Everyone with Wrenchworks open sees each change as it happens, the icon counts the open orders, and the other mechanics get a notification when an order is filed.

## Install

1. Copy this folder into your resources as `wrenchworks`.
2. `ensure wrenchworks` after `ensure sd-computers` in your `server.cfg`.

It registers itself with sd-computers whenever that is ready, restarts included. It does not list sd-computers as a `dependency` on purpose: that would stop it every time sd-computers restarts.

To limit who gets it, edit `Config` at the top of `server.lua`: `Groups = { mechanic = 0 }`, or `Computers = { 'business_laptop' }`.

`/workorder 12` (at a computer with Wrenchworks) brings it up on order #12.

## Files

| File | What it is |
|---|---|
| `server.lua` | Registers the app (`AddCustomApp`), keeps the orders (a resource KVP), the endpoints the page calls, the printed page, notifications and badges |
| `client.lua` | What only the game knows: the car next to the player (`carInBay`, a NUI callback), pushed to the page while the app is open |
| `web/index.html`, `web/app.css`, `web/app.js` | The page: plain HTML, CSS and JavaScript, no build step |
| `web/icon.svg` | The app's icon |

## Where each call is

| In the app | The API |
|---|---|
| Loading, filing and changing orders | `endpoints` in `server.lua`, `computer.callServer` in `app.js`; a refusal is `return false, 'message'` |
| Every open window updates; the icon counts open orders | `SendAppMessage(-1, ...)` and `SetAppBadge(-1, ...)`, heard by `computer.onMessage` |
| "New work order" notifications for the others | `NotifyApp`, `computer.onNotificationClick` |
| In the bay | `fetchNui('carInBay')`; `SendCustomAppMessage` from `client.lua`, started on `sd-computers:appOpened` |
| Right-click an order; delete; set a quote | `computer.menu`, `computer.dialog.confirm` / `prompt` / `alert`, `computer.sound` |
| A photo and a label colour | `computer.pickPhoto`, `computer.pickColor` |
| Print; email the customer | `print` in `server.lua`, `computer.print`, `computer.openApp('mail', ...)` |
| A finished order in the Event Viewer | `AddLog` with `ctx.computer.instance` |
| The bay note (per computer) and the filter (per character) | `computer.storage` with both scopes; `computer.log` when the note changes |
| A half-written order asks before closing | `computer.window.preventClose` |
| The title counts open orders; the header dims in the background | `computer.window.setTitle`, `computer.window.on` |
| Its own look, light and dark, square on retro | `computer.settings`, `computer.onSettings`, `html[data-style]` |
| `/workorder 12` | `OpenApp`, `computer.launch`, `computer.onLaunch` |

In sd-computers' browser dev server (`npm run dev` in `web/`), `#ext:wrenchworks` opens this page with mock orders.
