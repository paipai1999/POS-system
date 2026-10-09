'use strict';

// Helpers for server tests: start a server on a temporary folder, and act like a signed-in device.
//   const t = await boot();                        // t.app, t.base, t.call(), t.login(name, pin), t.stop()
//   const admin = await t.login('Admin', '1234');
//   const r = await admin.put('expenses', { id: 'e1', ... });   // r.status is 'ok', 'error' (r.error says why) or 'conflict'
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');

async function boot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-test-'));
  const app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  async function call(pathname, { token, method = 'GET', body, raw } = {}) {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + pathname, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer()) };
  }

  // One person's device: remembers the versions it has seen, like js/sync/ does.
  class Device {
    constructor(token, user) { this.token = token; this.user = user; this.vers = {}; this.docs = {}; }
    async load() {
      const { data } = await call('/api/snapshot', { token: this.token });
      this.vers = {}; this.docs = {};
      for (const r of data.rows) { this.vers[r.col + '/' + r.id] = r.ver; this.docs[r.col + '/' + r.id] = r.data; }
      return data;
    }
    doc(col, id) { return this.docs[col + '/' + id] ? structuredClone(this.docs[col + '/' + id]) : undefined; }
    all(col) { return Object.entries(this.docs).filter(([k, d]) => k.startsWith(col + '/') && d).map(([, d]) => structuredClone(d)); }
    // Saves one document (a new one, or a changed copy of one this device has seen).
    async put(col, doc, id = doc.id) {
      const change = { col, id, base: this.vers[col + '/' + id] || 0, data: doc };
      const { data } = await call('/api/sync', { token: this.token, method: 'POST', body: { changes: [change] } });
      const r = data.results[0];
      this.vers[col + '/' + id] = r.ver;
      this.docs[col + '/' + id] = r.doc;
      return r;
    }
    async remove(col, id) {
      const { data } = await call('/api/sync', { token: this.token, method: 'POST', body: { changes: [{ col, id, base: this.vers[col + '/' + id] || 0, deleted: true }] } });
      const r = data.results[0];
      this.vers[col + '/' + id] = r.ver;
      delete this.docs[col + '/' + id];
      return r;
    }
  }

  async function login(name, pin) {
    const users = (await call('/api/public')).data.users;
    const r = await call('/api/login', { method: 'POST', body: { userId: users.find(u => u.name === name).id, pin } });
    const dev = new Device(r.data.token, r.data.user);
    await dev.load();
    return dev;
  }

  return {
    app, base, dataDir, call, login, Device,
    async stop() { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

let counter = 0;
const newId = prefix => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

module.exports = { boot, newId };
