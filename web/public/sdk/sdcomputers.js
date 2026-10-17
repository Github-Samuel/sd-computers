/*
 * sd-computers custom app SDK.
 *
 * The desktop puts this into an app's page when its window opens, as window.computer. A page
 * served from another origin than its resource (a dev server, a site) can load it itself:
 *   <script src="https://cfx-nui-sd-computers/web/build/sdk/sdcomputers.js"></script>
 * Types: sdcomputers.d.ts beside this file. The reference: the sd-computers docs, "Custom apps".
 *
 * Everything here talks to the window holding the page with postMessage (src/apps/ext in the
 * sd-computers web source). Nothing in it reaches the server by itself: computer.callServer goes
 * through the desktop's own channel to the app's endpoints, behind the computer's session checks.
 */
(function () {
  'use strict';

  if (window.computer && window.computer.__sdc) return;

  var inComputer = window.parent !== window;
  // This document's name for itself: a reply to a call an earlier document in the same frame made
  // (before a reload) carries that one's name, and is not taken for one of ours.
  var doc = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var info = null;
  var seq = 0;
  var pending = new Map();
  var messageHandlers = new Map();
  var handlers = { settings: new Set(), launch: new Set(), window: new Set(), notification: new Set(), ready: new Set() };
  var resolveReady;
  var readyPromise = new Promise(function (resolve) {
    resolveReady = resolve;
  });

  function send(msg) {
    msg.sdc = 1;
    try {
      window.parent.postMessage(msg, '*');
    } catch (err) {
      console.error('[sd-computers] could not reach the desktop', err);
    }
  }

  function call(method, args) {
    if (!inComputer) return Promise.reject(new Error('Not running on a computer (open the page from its app window).'));
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      send({ type: 'call', doc: doc, id: id, method: method, args: args || [] });
    });
  }

  function run(set, value, label) {
    set.forEach(function (fn) {
      try {
        fn(value);
      } catch (err) {
        console.error('[sd-computers] ' + label + ' handler threw', err);
      }
    });
  }

  function subscribe(set, fn) {
    if (typeof fn !== 'function') return function () {};
    set.add(fn);
    return function () {
      set.delete(fn);
    };
  }

  // The OS's look, on the page's root: --sdc-* colours, data-theme / data-style.
  function applySettings(s) {
    if (!s) return;
    var root = document.documentElement;
    var colors = s.colors || {};
    Object.keys(colors).forEach(function (name) {
      root.style.setProperty('--sdc-' + name, colors[name]);
    });
    if (s.font) root.style.setProperty('--sdc-font', s.font);
    root.setAttribute('data-theme', s.theme);
    root.setAttribute('data-style', s.style);
  }

  // null (or nothing) takes a key away rather than keeping the word "null" under it.
  function json(value) {
    return value === undefined || value === null ? null : JSON.stringify(value);
  }

  function scopeOf(opts) {
    return opts && opts.scope === 'computer' ? 'computer' : 'character';
  }

  // Strips what cannot be posted (functions) from a menu's items, keeping their onClick here.
  function menuItems(items) {
    return (Array.isArray(items) ? items : []).map(function (it, i) {
      it = it || {};
      return {
        id: it.id != null ? String(it.id) : String(i),
        label: it.label != null ? String(it.label) : '',
        danger: !!it.danger,
        disabled: !!it.disabled,
        separator: !!it.separator,
      };
    });
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var m = e.data;
    if (!m || m.sdc !== 1) return;

    if (m.type === 'init') {
      var first = !info;
      info = m.data;
      applySettings(info.settings);
      // (a page written for sd-phone keeps itself hidden until its host shows it)
      document.documentElement.style.visibility = 'visible';
      if (document.body) document.body.style.visibility = 'visible';
      if (!first) return;
      resolveReady(api);
      run(handlers.ready, api, 'ready');
      window.dispatchEvent(new CustomEvent('computer:ready', { detail: api }));
      return;
    }

    if (m.type === 'reply') {
      if (m.doc !== doc) return;
      var p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(m.error || 'The computer refused that.'));
      return;
    }

    if (m.type !== 'event' || !info) return;
    if (m.name === 'message') {
      var d = m.data || {};
      var set = messageHandlers.get(d.action);
      if (set) run(set, d.data, 'onMessage(' + d.action + ')');
      var any = messageHandlers.get('*');
      if (any) {
        any.forEach(function (fn) {
          try {
            fn(d.action, d.data);
          } catch (err) {
            console.error('[sd-computers] onMessage(*) handler threw', err);
          }
        });
      }
    } else if (m.name === 'settings') {
      info.settings = m.data;
      applySettings(m.data);
      run(handlers.settings, m.data, 'onSettings');
    } else if (m.name === 'launch') {
      info.launch = m.data;
      run(handlers.launch, m.data, 'onLaunch');
    } else if (m.name === 'window') {
      info.window = m.data;
      run(handlers.window, m.data, 'window.on');
    } else if (m.name === 'notification') {
      run(handlers.notification, m.data, 'onNotificationClick');
    }
  });

  // Whether the field with focus is one that is typed into: Escape then asks twice before it
  // stands the player up, as it does over the desktop's own fields.
  function typing() {
    var el = document.activeElement;
    if (!el) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    return !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(el.type || 'text');
  }
  var wasTyping = false;
  function reportTyping() {
    var now = typing();
    if (now === wasTyping) return;
    wasTyping = now;
    send({ type: 'typing', on: now });
  }
  document.addEventListener('focusin', reportTyping);
  document.addEventListener('focusout', function () {
    setTimeout(reportTyping, 0);
  });

  // Escape and Alt+F4 the page did not use (no preventDefault) are the desktop's.
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && !(e.key === 'F4' && e.altKey)) return;
    setTimeout(function () {
      if (!e.defaultPrevented) send({ type: 'key', key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
    }, 0);
  });

  function resourceName() {
    if (info) return info.app.resource;
    var host = location.hostname.match(/^cfx-nui-(.+)$/);
    return host ? host[1] : '';
  }

  function fetchNuiStrict(event, data) {
    var res = resourceName();
    if (!res) return Promise.reject(new Error('fetchNui: no resource to send "' + event + '" to'));
    return fetch('https://' + res + '/' + event, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(data === undefined ? {} : data),
    }).then(function (r) {
      if (!r.ok) throw new Error('fetchNui ' + event + ': ' + r.status);
      return r.text().then(function (body) {
        return body ? JSON.parse(body) : undefined;
      });
    });
  }

  function fetchNui(event, data) {
    return fetchNuiStrict(event, data).catch(function (err) {
      console.warn('[sd-computers] ' + (err && err.message ? err.message : err));
      return undefined;
    });
  }

  var api = {
    __sdc: true,
    /** true while the page is in an app window on a computer (false in a plain browser tab). */
    inComputer: inComputer,
    get isReady() {
      return info !== null;
    },
    ready: function (cb) {
      if (typeof cb === 'function') readyPromise.then(cb);
      return readyPromise;
    },
    get version() {
      return info ? info.version : 0;
    },
    supports: function (name) {
      return !!info && info.methods.indexOf(name) >= 0 && info.unavailable.indexOf(name) < 0;
    },
    get app() {
      return info && info.app;
    },
    get machine() {
      return info && info.machine;
    },
    get user() {
      return info && info.user;
    },
    get settings() {
      return info && info.settings;
    },
    get launch() {
      return info ? info.launch : null;
    },

    fetchNui: fetchNui,
    fetchNuiStrict: fetchNuiStrict,

    callServer: function (endpoint, data) {
      return call('callServer', [endpoint, data === undefined ? null : data]);
    },
    onMessage: function (action, fn) {
      if (typeof action !== 'string' || typeof fn !== 'function') return function () {};
      var set = messageHandlers.get(action);
      if (!set) {
        set = new Set();
        messageHandlers.set(action, set);
      }
      return subscribe(set, fn);
    },

    notify: function (n) {
      return call('notify', [n]);
    },
    onNotificationClick: function (fn) {
      return subscribe(handlers.notification, fn);
    },
    setBadge: function (count) {
      return call('setBadge', [count]);
    },

    dialog: {
      alert: function (opts) {
        return call('dialog.alert', [typeof opts === 'string' ? { message: opts } : opts]);
      },
      confirm: function (opts) {
        return call('dialog.confirm', [typeof opts === 'string' ? { message: opts } : opts]);
      },
      prompt: function (opts) {
        return call('dialog.prompt', [typeof opts === 'string' ? { title: opts } : opts]);
      },
    },
    menu: function (at, items) {
      // menu(event, items) or menu({ x, y, items })
      var opts = at && Array.isArray(items) ? { x: at.clientX != null ? at.clientX : at.x, y: at.clientY != null ? at.clientY : at.y, items: items } : at || {};
      if (at && typeof at.preventDefault === 'function') at.preventDefault();
      var list = Array.isArray(opts.items) ? opts.items : [];
      return call('menu', [{ x: opts.x, y: opts.y, items: menuItems(list) }]).then(function (id) {
        if (id === null || id === undefined) return null;
        var picked = list.filter(function (it, i) {
          return (it && it.id != null ? String(it.id) : String(i)) === id;
        })[0];
        if (picked && typeof picked.onClick === 'function') picked.onClick();
        return id;
      });
    },
    pickPhoto: function () {
      return call('pickPhoto', []);
    },
    pickColor: function (initial) {
      return call('pickColor', [initial]);
    },
    print: function (job) {
      return call('print', [job]);
    },
    openApp: function (id, props) {
      return call('openApp', [id, props === undefined ? null : props]);
    },

    storage: {
      get: function (key, fallback, opts) {
        return call('storage.get', [key, scopeOf(opts)]).then(function (raw) {
          if (raw === null || raw === undefined) return fallback === undefined ? null : fallback;
          try {
            return JSON.parse(raw);
          } catch (err) {
            return fallback === undefined ? null : fallback;
          }
        });
      },
      set: function (key, value, opts) {
        return call('storage.set', [key, json(value), scopeOf(opts)]).then(
          function () {
            return true;
          },
          function (err) {
            console.warn('[sd-computers] storage.set("' + key + '"): ' + err.message);
            return false;
          },
        );
      },
      remove: function (key, opts) {
        return api.storage.set(key, null, opts);
      },
      keys: function (opts) {
        return call('storage.keys', [scopeOf(opts)]);
      },
      clear: function (opts) {
        return call('storage.clear', [scopeOf(opts)]);
      },
    },

    sound: function (name) {
      return call('sound', [name]);
    },
    log: function (message, level, data) {
      return call('log', [{ message: String(message), level: level, data: data }]);
    },

    onSettings: function (fn) {
      return subscribe(handlers.settings, fn);
    },
    onLaunch: function (fn) {
      return subscribe(handlers.launch, fn);
    },

    window: {
      setTitle: function (title) {
        return call('window.setTitle', [title]);
      },
      close: function () {
        return call('window.close', []);
      },
      minimize: function () {
        return call('window.minimize', []);
      },
      maximize: function () {
        return call('window.maximize', []);
      },
      restore: function () {
        return call('window.restore', []);
      },
      focus: function () {
        return call('window.focus', []);
      },
      preventClose: function (message) {
        return call('window.preventClose', [message === undefined ? true : message]);
      },
      state: function () {
        return info ? info.window : null;
      },
      on: function (fn) {
        return subscribe(handlers.window, fn);
      },
    },
  };

  window.computer = api;
  if (typeof window.fetchNui !== 'function') window.fetchNui = fetchNui;

  if (inComputer) send({ type: 'hello', doc: doc });
})();
