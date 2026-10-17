// Wrenchworks - the page. Plain JavaScript, no build step: edit and restart the resource.
//
// `computer` is the sd-computers SDK. The desktop puts it into this page once the page has loaded,
// so it does not exist yet while this file first runs: everything starts in start(), once the
// desktop has said the page is ready. Every call below is one the SDK documents; each is used where
// a real program would use it, so this file reads as a tour of the API.

(function () {
  'use strict';

  /** Resolves with the SDK once the desktop is ready (whether it was put in before or after this ran). */
  function whenComputer() {
    return new Promise(function (resolve) {
      if (window.computer && window.computer.isReady) return resolve(window.computer);
      window.addEventListener('computer:ready', function (e) { resolve(e.detail); }, { once: true });
    });
  }

  var $ = function (sel) { return document.querySelector(sel); };
  var app = $('#app');
  var STATUS = { open: 'Open', progress: 'In progress', done: 'Done' };

  var computer = null;
  var state = {
    orders: [],
    me: '',
    selected: null,
    bay: null,
    search: '',
    prefs: { filter: 'all', matchTheme: true },
    note: '',
    notedAt: '',
    draftPhoto: null,
    shownOpen: -1,
    drawn: false,
  };

  // Opened straight in a browser tab rather than in its window on a computer.
  if (window.parent === window) {
    $('#outside').hidden = false;
    app.classList.remove('is-loading');
    return;
  }

  whenComputer().then(start);

  // ── Starting ──────────────────────────────────────────────────────────────────────────────

  function start(c) {
    computer = c;
    app.classList.remove('is-loading');

    // Who and where: the machine and the player, as the desktop knows them.
    $('#shop').textContent = c.machine.label + '  ·  ' + c.machine.hostname;
    $('#me').textContent = c.user.name;
    $('#version').textContent = 'Wrenchworks ' + (c.app.version || '') + ' on ' + c.machine.os;

    // Character storage: preferences that follow this character to every computer.
    c.storage.get('prefs', {}).then(function (prefs) {
      Object.assign(state.prefs, prefs || {});
      $('#matchTheme').checked = state.prefs.matchTheme !== false;
      applyTheme();
      render();
    });

    // Computer storage: one note shared by everyone who uses this machine.
    c.storage.get('bay-note', '', { scope: 'computer' }).then(function (note) {
      state.note = state.notedAt = note || '';
      $('#note').value = state.note;
    });

    // The desktop's light/dark (and its look: retro squares our corners off - see app.css).
    applyTheme();
    c.onSettings(applyTheme);

    // A window that is not the focused one dims its header, as the desktop's own do.
    c.window.on(function (w) { app.classList.toggle('is-unfocused', !w.focused); });

    // What the server pushes to every open Wrenchworks: the order book changed.
    c.onMessage('orders', onOrders);
    // What this client's script pushes: a different car rolled into the bay.
    c.onMessage('bay', setBay);
    // Ask this client's script directly too (fetchNui reaches this resource's NUI callbacks).
    c.fetchNui('carInBay').then(setBay);

    // Opened on an order: /workorder 12 (OpenApp from the server), or a notification clicked.
    c.onLaunch(openFrom);
    c.onNotificationClick(openFrom);

    load().then(function () { openFrom(c.launch); });
    wire();
  }

  function openFrom(props) {
    if (props && props.order) select(Number(props.order));
  }

  function applyTheme() {
    var s = computer && computer.settings;
    var dark = state.prefs.matchTheme === false || !s ? true : s.theme === 'dark';
    app.setAttribute('data-mode', dark ? 'dark' : 'light');
  }

  // ── The order book ────────────────────────────────────────────────────────────────────────

  function load() {
    // The app's own server endpoint, reached through the computer: it only runs for a player
    // signed in at a computer that has Wrenchworks.
    return computer.callServer('orders:list').then(function (res) {
      state.orders = res.orders || [];
      state.me = res.me || '';
      render();
    }, oops);
  }

  function onOrders(push) {
    var mine = push.by === state.me;
    state.orders = push.orders || [];
    if (push.kind === 'deleted' && state.selected === push.order.id) state.selected = null;
    render();

    // Someone else finished a job while this window was in the background: tell this player.
    var w = computer.window.state();
    if (push.kind === 'updated' && push.order.status === 'done' && !mine && w && !w.focused) {
      computer.notify({
        title: 'Work order #' + push.order.id + ' is done',
        body: push.by + ' finished the ' + push.order.model + ' (' + push.order.plate + ')',
        data: { order: push.order.id },
      });
    }
  }

  function save(id, change) {
    return computer.callServer('orders:update', Object.assign({ id: id }, change)).catch(oops);
  }

  function find(id) {
    return state.orders.filter(function (o) { return o.id === id; })[0] || null;
  }

  function counts() {
    var n = { all: state.orders.length, open: 0, progress: 0, done: 0 };
    state.orders.forEach(function (o) { n[o.status] += 1; });
    return n;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────────────────────

  function render() {
    var n = counts();
    var open = n.open + n.progress;

    document.querySelectorAll('#filters button').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.filter === state.prefs.filter);
    });
    Object.keys(n).forEach(function (k) {
      var el = document.querySelector('[data-count="' + k + '"]');
      if (el) el.textContent = n[k];
    });

    // The window's title and the icon's count say how much work is waiting.
    if (computer && open !== state.shownOpen) {
      state.shownOpen = open;
      computer.window.setTitle(open ? 'Wrenchworks - ' + open + ' open' : 'Wrenchworks');
      computer.setBadge(open);
    }

    var q = state.search.toLowerCase();
    var shown = state.orders
      .filter(function (o) { return state.prefs.filter === 'all' || o.status === state.prefs.filter; })
      .filter(function (o) { return !q || (o.plate + ' ' + o.model + ' ' + o.customer).toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return (a.status === 'done') - (b.status === 'done') || b.updatedAt - a.updatedAt; });

    var list = $('#list');
    list.textContent = '';
    shown.forEach(function (o, i) { list.appendChild(row(o, i)); });
    list.classList.toggle('is-settled', state.drawn);
    state.drawn = true;
    $('#empty').hidden = shown.length > 0;
    list.hidden = shown.length === 0;
    $('#listCount').textContent = shown.length + (shown.length === 1 ? ' order' : ' orders');

    renderDetail();
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function plate(text) {
    return el('span', 'ww-plate', text);
  }

  function pill(status) {
    return el('span', 'ww-pill is-' + status, STATUS[status]);
  }

  function money(n) {
    return '$' + Number(n || 0).toLocaleString('en-US');
  }

  function ago(ts) {
    var s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function row(o, i) {
    var r = el('div', 'ww-row' + (o.id === state.selected ? ' is-selected' : ''));
    r.style.animationDelay = Math.min(i, 12) * 18 + 'ms';
    var stripe = el('span', 'ww-stripe');
    if (o.color) stripe.style.background = o.color;
    var who = el('div', 'ww-who');
    who.appendChild(el('b', null, o.model + '  ·  ' + o.customer));
    who.appendChild(el('span', null, o.work));
    r.append(stripe, el('span', 'ww-id', '#' + o.id), plate(o.plate), who, pill(o.status), el('span', 'ww-quote', money(o.quote)), el('span', 'ww-age', ago(o.updatedAt)));
    r.addEventListener('click', function () { select(o.id); });
    // The desktop's own context menu, at the pointer. Each item's onClick runs when it is picked.
    r.addEventListener('contextmenu', function (e) {
      select(o.id);
      computer.menu(e, menuFor(o));
    });
    return r;
  }

  function menuFor(o) {
    return [
      { label: o.status === 'progress' ? 'Mark as done' : o.status === 'done' ? 'Reopen' : 'Start work', onClick: function () { advance(o); } },
      { label: 'Set the quote...', onClick: function () { askQuote(o); } },
      { label: 'Label colour...', onClick: function () { askColour(o); } },
      { separator: true },
      { label: 'Print work order', onClick: function () { printOrder(o); } },
      { label: 'Email the customer', disabled: !o.contact, onClick: function () { email(o); } },
      { separator: true },
      { label: 'Delete', danger: true, onClick: function () { remove(o); } },
    ];
  }

  function select(id) {
    if (!find(id)) return;
    state.selected = id;
    render();
  }

  function renderDetail() {
    var pane = $('#detail');
    var o = state.selected && find(state.selected);
    pane.hidden = !o;
    $('.ww-body').classList.toggle('has-detail', !!o);
    if (!o) return;
    pane.textContent = '';

    var head = el('div', 'ww-detail-head');
    if (o.color) head.style.borderTopColor = o.color;
    var top = el('div', 'ww-detail-top');
    var x = el('button', 'ww-x');
    x.type = 'button';
    x.title = 'Close';
    x.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>';
    x.addEventListener('click', function () {
      state.selected = null;
      render();
    });
    top.append(plate(o.plate), pill(o.status), x);
    head.append(top, el('h2', null, o.model), el('p', null, 'Work order #' + o.id + ', opened by ' + o.createdBy + ' ' + ago(o.createdAt)));
    pane.appendChild(head);

    if (o.photo) {
      var img = el('img', 'ww-photo');
      img.src = o.photo;
      img.alt = '';
      pane.appendChild(img);
    }

    var facts = el('dl', 'ww-facts');
    [['Customer', o.customer], ['Email', o.contact || '-'], ['Quote', money(o.quote)], ['Updated', ago(o.updatedAt)]]
      .concat(o.closedBy ? [['Finished by', o.closedBy]] : [])
      .forEach(function (f) { facts.append(el('dt', null, f[0]), el('dd', null, f[1])); });
    pane.appendChild(facts);
    pane.appendChild(el('div', 'ww-work', o.work));

    var actions = el('div', 'ww-actions');
    var next = button(o.status === 'progress' ? 'Mark as done' : o.status === 'done' ? 'Reopen' : 'Start work', 'ww-btn-primary', function () { advance(o); });
    actions.append(
      next,
      button('Quote', 'ww-btn-ghost ww-btn-sm', function () { askQuote(o); }),
      button(o.photo ? 'New photo' : 'Add photo', 'ww-btn-ghost ww-btn-sm', function () { attachTo(o); }),
      button('Colour', 'ww-btn-ghost ww-btn-sm', function () { askColour(o); }),
      button('Print', 'ww-btn-ghost ww-btn-sm', function () { printOrder(o); }),
      button('Email', 'ww-btn-ghost ww-btn-sm', function () { email(o); }, !o.contact),
      button('Delete', 'ww-btn-danger ww-btn-sm', function () { remove(o); }),
    );
    pane.appendChild(actions);
  }

  function button(label, cls, onClick, disabled) {
    var b = el('button', 'ww-btn ' + cls, label);
    b.type = 'button';
    b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  // ── Doing things to an order ──────────────────────────────────────────────────────────────

  function advance(o) {
    save(o.id, { status: o.status === 'open' ? 'progress' : o.status === 'progress' ? 'done' : 'open' });
  }

  function askQuote(o) {
    // The desktop's own text prompt. null = cancelled.
    computer.dialog.prompt({ title: 'Quote for #' + o.id, message: 'What will the ' + o.model + ' cost the customer?', value: String(o.quote || ''), placeholder: '0', confirmLabel: 'Set quote' }).then(function (v) {
      if (v === null) return;
      var n = Math.floor(Number(String(v).replace(/[$,\s]/g, '')));
      if (!isFinite(n) || n < 0) {
        computer.sound('error');
        return computer.dialog.alert({ title: 'Not a price', message: '"' + v + '" is not an amount of dollars.' });
      }
      save(o.id, { quote: n });
    });
  }

  function askColour(o) {
    computer.pickColor(o.color || '#f2711c').then(function (colour) {
      if (colour) save(o.id, { color: colour });
    });
  }

  function attachTo(o) {
    if (!computer.supports('pickPhoto')) return computer.dialog.alert({ title: 'No Photos here', message: 'This computer has no Photos app to pick from.' });
    computer.pickPhoto().then(function (photo) {
      if (photo) save(o.id, { photo: photo.url });
    });
  }

  function printOrder(o) {
    if (!computer.supports('print')) return computer.dialog.alert({ title: 'No printing', message: 'This computer cannot print.' });
    // The server's `print` function builds the page from its own copy of the order.
    computer.print({ title: 'Work order #' + o.id, data: { id: o.id } });
  }

  function email(o) {
    if (!o.contact) return;
    // Another app, opened on what to write: Mail takes { to, subject }.
    computer.openApp('mail', { to: o.contact, subject: 'Your ' + o.model + ' (' + o.plate + ') - work order #' + o.id }).catch(oops);
  }

  function remove(o) {
    computer.dialog.confirm({ title: 'Delete work order #' + o.id + '?', message: 'The ' + o.model + ' (' + o.plate + ') comes off the board for everyone.', confirmLabel: 'Delete', danger: true }).then(function (yes) {
      if (!yes) return;
      computer.callServer('orders:delete', { id: o.id }).catch(oops);
    });
  }

  function oops(err) {
    computer.sound('error');
    computer.dialog.alert({ title: 'Wrenchworks', message: err && err.message ? err.message : String(err) });
  }

  // ── The car in the bay ────────────────────────────────────────────────────────────────────

  function setBay(car) {
    state.bay = car || null;
    $('#bay').hidden = !state.bay;
    $('#useBay').disabled = !state.bay;
    if (!state.bay) return;
    $('#bayCar').textContent = state.bay.model;
    $('#bayPlate').textContent = state.bay.plate;
  }

  // ── New work order ────────────────────────────────────────────────────────────────────────

  var form = $('#form');

  function dirty() {
    var d = new FormData(form);
    var any = false;
    d.forEach(function (v) { if (String(v).trim() !== '') any = true; });
    return any || !!state.draftPhoto;
  }

  function openForm() {
    form.reset();
    state.draftPhoto = null;
    $('#formPhotoPreview').hidden = true;
    $('#sheet').hidden = false;
    form.elements.plate.focus();
  }

  function closeForm() {
    $('#sheet').hidden = true;
    // Nothing left to lose: closing the window no longer asks.
    computer.window.preventClose(false);
  }

  function cancelForm() {
    if (!dirty()) return closeForm();
    computer.dialog.confirm({ title: 'Discard this work order?', message: 'What you typed is not filed yet.', confirmLabel: 'Discard', danger: true }).then(function (yes) {
      if (yes) closeForm();
    });
  }

  function submit(e) {
    e.preventDefault();
    var d = new FormData(form);
    var order = {
      plate: String(d.get('plate') || '').trim(),
      model: String(d.get('model') || '').trim(),
      customer: String(d.get('customer') || '').trim(),
      contact: String(d.get('contact') || '').trim(),
      work: String(d.get('work') || '').trim(),
      quote: Number(d.get('quote') || 0),
      photo: state.draftPhoto,
    };
    if (!order.plate || !order.work) {
      computer.sound('error');
      computer.dialog.alert({ title: 'Almost there', message: !order.plate ? 'A work order needs the car\'s plate.' : 'Say what is to be done.' });
      return;
    }
    computer.callServer('orders:create', order).then(function (saved) {
      closeForm();
      state.selected = saved.id;
      render();
    }, oops);
  }

  // ── Wiring ────────────────────────────────────────────────────────────────────────────────

  function wire() {
    $('#newOrder').addEventListener('click', openForm);
    $('#cancelForm').addEventListener('click', cancelForm);
    form.addEventListener('submit', submit);

    // Typing into the form: closing the window (or standing up) now asks first.
    form.addEventListener('input', function () {
      computer.window.preventClose(dirty() ? 'The new work order you are writing is not filed yet.' : false);
    });

    // Escape is ours while the form is up (preventDefault tells the desktop we used it).
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('#sheet').hidden) {
        e.preventDefault();
        cancelForm();
      }
    });

    $('#useBay').addEventListener('click', function () {
      computer.fetchNui('carInBay').then(function (car) {
        setBay(car);
        if (!car) return;
        form.elements.plate.value = car.plate;
        form.elements.model.value = car.model;
        computer.window.preventClose('The new work order you are writing is not filed yet.');
      });
    });

    $('#formPhoto').addEventListener('click', function () {
      if (!computer.supports('pickPhoto')) return computer.dialog.alert({ title: 'No Photos here', message: 'This computer has no Photos app to pick from.' });
      computer.pickPhoto().then(function (photo) {
        if (!photo) return;
        state.draftPhoto = photo.url;
        var img = $('#formPhotoPreview');
        img.src = photo.url;
        img.hidden = false;
      });
    });

    $('#filters').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.prefs.filter = b.dataset.filter;
      computer.storage.set('prefs', state.prefs);
      render();
    });

    $('#search').addEventListener('input', function (e) {
      state.search = e.target.value;
      render();
    });

    $('#matchTheme').addEventListener('change', function (e) {
      state.prefs.matchTheme = e.target.checked;
      computer.storage.set('prefs', state.prefs);
      applyTheme();
    });

    // The bay note is kept on this machine a moment after typing stops, and its last change goes
    // into the computer's Event Viewer when the player leaves the field.
    var timer = 0;
    $('#note').addEventListener('input', function (e) {
      state.note = e.target.value;
      $('#noteState').textContent = 'Saving...';
      clearTimeout(timer);
      timer = setTimeout(function () {
        computer.storage.set('bay-note', state.note, { scope: 'computer' }).then(function (ok) {
          $('#noteState').textContent = ok ? 'Saved on this computer' : 'Could not save';
        });
      }, 700);
    });
    $('#note').addEventListener('blur', function () {
      if (state.note === state.notedAt) return;
      state.notedAt = state.note;
      computer.log('Bay note changed: ' + (state.note.slice(0, 120) || '(cleared)'));
    });

    // Ages on the rows keep up with the clock.
    setInterval(render, 60000);
  }
})();
