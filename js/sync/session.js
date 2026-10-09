'use strict';

// Signing in and out of the server, and loading everything a device needs at sign-in.
Object.assign(Sync, {
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
    this.ledgerSince = s.ledgerSince || s.since;
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
});
