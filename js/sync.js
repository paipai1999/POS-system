'use strict';

// Server mode: keeps Store.data in sync with the POS server.
// Screens keep editing Store.data and calling Store.save(); save() asks Sync to send whatever documents
// changed since the server last confirmed them. Changes from other devices arrive over an event stream.
const Sync = {
  enabled: false,
  token: null,
  userId: null,
  seq: 0,
  synced: {},        // col -> id -> { ver, json } as last confirmed by the server
  loadedSince: 0,    // orders older than this are fetched on demand (reports, order history)
  online: true,
  inflight: false,
  again: false,
  timer: null,
  retryMs: 1000,
  es: null,
  stations: 0,
  addresses: [],
  guestCode: null,
  orderLoads: {},

  async detect() {
    if (!/^https?:$/.test(location.protocol)) return false;
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) return false;
      const h = await res.json();
      this.addresses = h.addresses || [];
      this.stations = h.stations || 0;
      return !!h.server;
    } catch (e) {
      return false;
    }
  },

  async api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch (e) {
      const err = new Error('Cannot reach the POS server. Check the Wi-Fi.');
      err.network = true;
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Server error (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  emptyData() {
    const data = { version: 1, settings: { name: 'POS', currency: '$', taxRate: 0, serviceRate: 0, receiptFooter: '', printKitchenTickets: false } };
    for (const col of COLLECTIONS) data[col] = [];
    return data;
  },

  // ----- signed out: names for the login screen only -----
  async loadPublic() {
    const p = await this.api('/api/public');
    Store.data = this.emptyData();
    Object.assign(Store.data.settings, p.settings);
    Store.data.users = p.users;
    Store.data.demo = p.demo;
    this.synced = {};
  },

  // ----- staff session -----
  async login(userId, pin) {
    const r = await this.api('/api/login', { method: 'POST', body: { userId, pin } });
    this.setToken(r.token);
    await this.loadSnapshot();
    this.mustChangePin = !!r.mustChangePin;
    return Store.user(r.user.id);
  },

  // A phone that reloads the page stays signed in for the rest of the shift.
  async restoreSession() {
    let token = null;
    try { token = sessionStorage.getItem('pos-token'); } catch (e) { token = null; }
    if (!token) return null;
    this.token = token;
    try {
      await this.loadSnapshot();
      return Store.user(this.userId) || null;
    } catch (e) {
      this.setToken(null);
      return null;
    }
  },

  setToken(token) {
    this.token = token;
    try {
      if (token) sessionStorage.setItem('pos-token', token);
      else sessionStorage.removeItem('pos-token');
    } catch (e) { /* private mode: stay signed in until the tab closes */ }
  },

  async loadSnapshot() {
    const s = await this.api('/api/snapshot');
    const data = this.emptyData();
    this.synced = {};
    for (const row of s.rows) {
      if (row.col === 'settings') data.settings = row.data;
      else if (data[row.col]) data[row.col].push(row.data);
      this.remember(row.col, row.id, row.ver, row.data);
    }
    Store.sortCategories(data);
    Store.data = data;
    this.userId = s.user.id;
    this.mustChangePin = !!s.mustChangePin;
    this.seq = s.seq;
    this.loadedSince = s.since;
    this.stations = s.stations;
    this.orderLoads = {};
    this.online = true;
    this.connect();
  },

  async logout() {
    try { await this.api('/api/logout', { method: 'POST' }); } catch (e) { /* signing out locally is enough */ }
    this.disconnect();
    clearTimeout(this.timer);
    this.setToken(null);
    this.synced = {};
    await this.loadPublic();
  },

  async verifyPin(pin) {
    const r = await this.api('/api/verify-pin', { method: 'POST', body: { pin } });
    return Store.user(r.user.id) || r.user;
  },

  // ----- sending changes -----
  docKey(col, doc) { return col === 'settings' ? 'main' : doc.id; },

  find(col, id) {
    if (col === 'settings') return Store.data.settings;
    return (Store.data[col] || []).find(d => d.id === id);
  },

  remember(col, id, ver, doc) {
    (this.synced[col] || (this.synced[col] = {}))[id] = { ver, json: JSON.stringify(doc) };
  },

  forget(col, id) {
    if (this.synced[col]) delete this.synced[col][id];
  },

  // Every document that differs from what the server last confirmed.
  pending() {
    if (!this.token || !Store.data) return [];
    const out = [];
    const seen = new Set();
    const consider = (col, doc) => {
      const id = this.docKey(col, doc);
      seen.add(col + '/' + id);
      const json = JSON.stringify(doc);
      const prev = this.synced[col] && this.synced[col][id];
      if (!prev || prev.json !== json) out.push({ col, id, base: prev ? prev.ver : 0, data: doc, json });
    };
    consider('settings', Store.data.settings);
    for (const col of COLLECTIONS) for (const doc of Store.data[col]) consider(col, doc);
    for (const col of Object.keys(this.synced)) {
      for (const id of Object.keys(this.synced[col])) {
        if (!seen.has(col + '/' + id)) out.push({ col, id, base: this.synced[col][id].ver, deleted: true });
      }
    }
    return out;
  },

  pendingCount() { return this.pending().length; },

  schedule() {
    if (!this.token) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 120);
    App.renderSyncStatus();
  },

  async flush() {
    if (!this.token) return;
    if (this.inflight) { this.again = true; return; }
    const changes = this.pending();
    if (!changes.length) return App.renderSyncStatus();
    this.inflight = true;
    let refresh = false;
    try {
      const res = await this.api('/api/sync', { method: 'POST', body: { changes: changes.map(({ json, ...c }) => c) } });
      this.setOnline(true);
      this.retryMs = 1000;
      const sent = new Map(changes.map(c => [c.col + '/' + c.id, c.json]));
      let conflicts = 0;
      for (const r of res.results) {
        if (r.status === 'conflict') conflicts++;
        if (r.status === 'error' && r.error) toast(r.error, 'error');
        if (this.applyResult(r, sent.get(r.col + '/' + r.id))) refresh = true;
      }
      if (conflicts) toast('Someone changed this on another device — showing the latest version', 'error');
    } catch (e) {
      if (e.status === 401) {
        this.inflight = false;
        return App.sessionExpired();
      }
      if (e.network || e.status >= 500) {
        this.setOnline(false);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 15000);
      } else {
        toast(e.message, 'error');
      }
    } finally {
      this.inflight = false;
      if (this.again) { this.again = false; this.schedule(); }
      App.renderSyncStatus();
    }
    if (refresh) App.liveRefresh(['orders', 'products', 'users', 'tables', 'settings', 'kitchenTickets', 'guestRequests', 'categories']);
  },

  // Returns true when the local copy changed (server assigned a number, rejected a change, …).
  applyResult(r, sentJson) {
    const local = this.find(r.col, r.id);
    if (r.deleted || !r.doc) {
      this.forget(r.col, r.id);
      if (local) { this.removeLocal(r.col, r.id); return true; }
      return false;
    }
    this.remember(r.col, r.id, r.ver, r.doc);
    if (!local) { this.addLocal(r.col, r.doc); return true; }
    const docJson = JSON.stringify(r.doc);
    if (r.status !== 'ok' || JSON.stringify(local) === sentJson) {
      if (JSON.stringify(local) === docJson) return false;
      this.replaceInPlace(local, r.doc);
      return true;
    }
    // Edited again while the request was in flight: keep the newer local edit, but take the order number.
    if (r.col === 'orders' && local.number == null && r.doc.number != null) { local.number = r.doc.number; return true; }
    return false;
  },

  // Replaces contents but keeps the same object, so screens holding a reference see the new values.
  replaceInPlace(target, src) {
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, JSON.parse(JSON.stringify(src)));
  },

  addLocal(col, doc) {
    const copy = JSON.parse(JSON.stringify(doc));
    if (col === 'settings') this.replaceInPlace(Store.data.settings, copy);
    else Store.data[col].push(copy);
  },

  removeLocal(col, id) {
    const arr = Store.data[col];
    if (!arr) return;
    const i = arr.findIndex(d => d.id === id);
    if (i >= 0) arr.splice(i, 1);
  },

  // ----- receiving changes -----
  applyRemote(rows, { advanceSeq = true } = {}) {
    const events = [];
    for (const row of rows) {
      if (row.col !== 'settings' && !COLLECTIONS.includes(row.col)) continue;
      if (advanceSeq && row.seq) this.seq = Math.max(this.seq, row.seq);
      const prev = this.synced[row.col] && this.synced[row.col][row.id];
      if (prev && prev.ver >= row.ver) continue;
      const local = this.find(row.col, row.id);
      const before = local ? { status: local.status } : null;
      // Unsent local edits win for now; the next flush will either apply them or come back as a conflict.
      const edited = !!local && (!prev || JSON.stringify(local) !== prev.json);
      if (row.deleted) {
        this.forget(row.col, row.id);
        if (local && !edited) this.removeLocal(row.col, row.id);
      } else {
        this.remember(row.col, row.id, row.ver, row.data);
        if (!local) this.addLocal(row.col, row.data);
        else if (!edited) this.replaceInPlace(local, row.data);
      }
      events.push({ col: row.col, id: row.id, doc: row.deleted ? null : this.find(row.col, row.id), before, isNew: !local && !prev });
    }
    if (!events.length) return;
    if (events.some(e => e.col === 'categories')) Store.sortCategories();
    App.onRemote(events);
  },

  connect() {
    this.disconnect();
    if (!this.token) return;
    const es = new EventSource('/api/events?token=' + encodeURIComponent(this.token));
    this.es = es;
    es.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type === 'hello') { this.stations = m.stations; this.catchUp(); }
      else if (m.type === 'change') this.applyRemote(m.rows);
      else if (m.type === 'stations') this.stations = m.count;
      else if (m.type === 'reload') location.reload();
    };
    es.onerror = () => {
      this.setOnline(false);
      // The browser reconnects by itself unless the server refused the stream (e.g. session ended).
      if (es.readyState === EventSource.CLOSED) {
        setTimeout(() => { if (this.es === es) { this.catchUp(); this.connect(); } }, 3000);
      }
    };
  },

  disconnect() {
    if (this.es) this.es.close();
    this.es = null;
  },

  // After (re)connecting: fetch anything missed while offline, then send what was queued.
  async catchUp() {
    if (!this.token) return;
    try {
      const r = await this.api('/api/changes?since=' + this.seq);
      this.applyRemote(r.rows);
      this.setOnline(true);
      this.flush();
    } catch (e) {
      if (e.status === 401) App.sessionExpired();
    }
  },

  setOnline(v) {
    if (this.online === v) return;
    this.online = v;
    App.renderSyncStatus();
  },

  // ----- order history outside the window loaded at sign-in -----
  ordersLoaded(from) {
    return !Store.server || !this.token || from >= this.loadedSince;
  },

  loadOrders(from) {
    if (this.ordersLoaded(from)) return Promise.resolve();
    if (!this.orderLoads[from]) {
      this.orderLoads[from] = this.api(`/api/orders?from=${from}&to=${this.loadedSince}`).then(r => {
        this.applyRemote(r.rows, { advanceSeq: false });
        this.loadedSince = Math.min(this.loadedSince, from);
      }).finally(() => { delete this.orderLoads[from]; });
    }
    return this.orderLoads[from];
  },

  // ----- guests -----
  async startGuest(code) {
    this.disconnect();
    this.setToken(null);
    this.synced = {};
    this.guestCode = code;
    await this.refreshGuest();
    const es = new EventSource('/api/guest/events?table=' + encodeURIComponent(code));
    this.es = es;
    let t = null;
    es.onmessage = () => {
      clearTimeout(t);
      t = setTimeout(() => this.refreshGuest().then(() => App.liveRefresh(['guest'])).catch(() => {}), 300);
    };
  },

  async refreshGuest() {
    const d = await this.api('/api/guest/state?table=' + encodeURIComponent(this.guestCode));
    Store.data = { ...this.emptyData(), ...d };
    Store.sortCategories();
  },

  async guestRequest(req) {
    await this.api('/api/guest/request', {
      method: 'POST',
      body: { table: this.guestCode, kind: req.kind, note: req.note, items: req.items.map(l => ({ productId: l.productId, qty: l.qty })) },
    });
    await this.refreshGuest();
  },

  leaveGuest() {
    this.disconnect();
    this.guestCode = null;
  },
};

// The counter PC registers as the printer station; other devices send it bills, receipts and kitchen tickets.
// It works while nobody is signed in on the counter, using a device key an admin created.
const Station = {
  key: null,
  es: null,
  queue: [],
  busy: false,

  init() {
    try { this.key = localStorage.getItem('pos-station-key'); } catch (e) { this.key = null; }
  },

  get active() { return !!this.key && Store.server; },

  start() {
    this.stop();
    if (!this.active) return;
    const es = new EventSource('/api/station/events?key=' + encodeURIComponent(this.key));
    this.es = es;
    es.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type === 'jobs') m.rows.forEach(r => this.handle(r));
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setTimeout(() => { if (this.es === es) this.start(); }, 5000);
    };
  },

  stop() {
    if (this.es) this.es.close();
    this.es = null;
  },

  async handle(row) {
    const job = row.data;
    if (row.deleted || !job || job.status !== 'pending' || Date.now() - job.createdAt > 15 * 60 * 1000) return;
    try {
      await this.post(job.id, 'printing'); // fails if another station already took it
    } catch (e) {
      return;
    }
    this.queue.push(job);
    this.drain();
  },

  drain() {
    if (this.busy || !this.queue.length) return;
    const job = this.queue.shift();
    this.busy = true;
    setTimeout(() => {
      printLocal(cleanPrintHTML(job.html), job.kind === 'sheet');
      this.post(job.id, 'done').catch(() => {});
      this.busy = false;
      this.drain();
    }, 50);
  },

  post(id, status) {
    return fetch('/api/station/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: this.key, id, status }),
    }).then(r => { if (!r.ok) throw new Error('rejected'); });
  },

  async enable() {
    const r = await Sync.api('/api/station/register', { method: 'POST' });
    this.key = r.key;
    try { localStorage.setItem('pos-station-key', r.key); } catch (e) { /* ignore */ }
    this.start();
  },

  async disable() {
    try { await Sync.api('/api/station/unregister', { method: 'POST', body: { key: this.key } }); } catch (e) { /* ignore */ }
    this.stop();
    this.key = null;
    try { localStorage.removeItem('pos-station-key'); } catch (e) { /* ignore */ }
  },
};
