'use strict';

// Sending this device's changes to the server (offline changes wait in the queue and go when the connection is back).
Object.assign(Sync, {
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
    if (refresh) App.liveRefresh(['orders', 'products', 'users', 'tables', 'settings', 'kitchenTickets', 'guestRequests', 'categories', 'shifts']);
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
});
