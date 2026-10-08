'use strict';

// Several devices at once, over the live event stream (what phones, tablets and the kitchen screen use).
// Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');
const { round2 } = require('../../js/shared.js');

let app, base, dataDir;

async function call(pathname, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// A stand-in for one device: remembers the versions it has seen, like js/sync.js does.
class Device {
  constructor(token, user) { this.token = token; this.user = user; this.vers = {}; this.docs = {}; }
  async load() {
    const { data } = await call('/api/snapshot', { token: this.token });
    for (const r of data.rows) { this.vers[r.col + '/' + r.id] = r.ver; this.docs[r.col + '/' + r.id] = r.data; }
    return data;
  }
  doc(col, id) { return structuredClone(this.docs[col + '/' + id]); }
  find(col, pred) { return Object.entries(this.docs).filter(([k, d]) => k.startsWith(col + '/') && d && pred(d)).map(([, d]) => structuredClone(d)); }
  async put(col, doc) {
    const change = { col, id: doc.id, base: this.vers[col + '/' + doc.id] || 0, data: doc };
    const { status, data } = await call('/api/sync', { token: this.token, method: 'POST', body: { changes: [change] } });
    assert.equal(status, 200, JSON.stringify(data));
    const r = data.results[0];
    this.vers[col + '/' + doc.id] = r.ver;
    this.docs[col + '/' + doc.id] = r.doc;
    return r;
  }
}

async function login(name, pin) {
  const { data: pub } = await call('/api/public');
  const user = pub.users.find(u => u.name === name);
  const { status, data } = await call('/api/login', { method: 'POST', body: { userId: user.id, pin } });
  assert.equal(status, 200);
  const dev = new Device(data.token, data.user);
  await dev.load();
  return dev;
}

const order = (dev, items, extra = {}) => ({
  id: 'o_' + Math.random().toString(36).slice(2), number: null, tableId: null, tableName: '', staffId: dev.user.id,
  status: 'open', note: '', discount: null, createdAt: Date.now(),
  items: items.map(([name, qty], i) => {
    const p = dev.find('products', x => x.name === name)[0];
    return { id: 'l_' + i, productId: p.id, name: p.name, price: p.price, qty, note: '', sentQty: 0 };
  }),
  ...extra,
});

// Opens an event stream like a phone does and collects what the server pushes.
async function listen(pathname) {
  const ctl = new AbortController();
  const res = await fetch(base + pathname, { signal: ctl.signal });
  assert.equal(res.status, 200, pathname);
  const events = [];
  const waiters = [];
  (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = block.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          const msg = JSON.parse(line.slice(6));
          events.push(msg);
          for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
        }
      }
    } catch (e) { /* aborted */ }
  })();
  return {
    // Resolves when a matching message has arrived (or already did); fails after 3 s.
    when(pred) {
      const hit = events.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => {
          if (waiters.includes(w)) { waiters.splice(waiters.indexOf(w), 1); reject(new Error('no matching event within 3 s')); }
        }, 3000);
      });
    },
    close: () => ctl.abort(),
  };
}

const changeOf = (col, pred = () => true) => m => m.type === 'change' && m.rows.some(r => r.col === col && !r.deleted && pred(r.data));

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-live-'));
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('one table, served live to guest, waiter, cashier and kitchen at the same time', async () => {
  const waiter = await login('Leo', '2222');
  const cashier = await login('Maya', '1111');
  const kitchen = await login('Kitchen', '3333');
  const table = waiter.find('tables', () => true)[3];
  const streams = {
    waiter: await listen('/api/events?token=' + waiter.token),
    cashier: await listen('/api/events?token=' + cashier.token),
    kitchen: await listen('/api/events?token=' + kitchen.token),
    guest: await listen('/api/guest/events?table=' + table.guestCode),
  };
  try {
    for (const k of ['waiter', 'cashier', 'kitchen']) await streams[k].when(m => m.type === 'hello');

    // 1. A guest at the table orders: waiter and cashier hear about it at once.
    const { data: menu } = await call('/api/guest/state?table=' + table.guestCode);
    const tea = menu.products.find(p => p.name === 'Green Tea');
    const sent = await call('/api/guest/request', { method: 'POST', body: { table: table.guestCode, kind: 'order', items: [{ productId: tea.id, qty: 2 }] } });
    assert.equal(sent.status, 200);
    await streams.waiter.when(changeOf('guestRequests', r => r.tableId === table.id && r.kind === 'order'));
    await streams.cashier.when(changeOf('guestRequests', r => r.tableId === table.id && r.kind === 'order'));

    // 2. The waiter opens the order and sends it to the kitchen: the kitchen and the cashier see it.
    const o = order(waiter, [['Green Tea', 2]], { tableId: table.id });
    assert.equal((await waiter.put('orders', o)).status, 'ok');
    const sentOrder = waiter.doc('orders', o.id);
    sentOrder.items.forEach(l => { l.sentQty = l.qty; });
    assert.equal((await waiter.put('orders', sentOrder)).status, 'ok');
    const ticket = { id: 'k_' + Math.random().toString(36).slice(2), orderId: o.id, status: 'new', createdAt: Date.now(), items: [{ name: 'Green Tea', qty: 2 }] };
    assert.equal((await waiter.put('kitchenTickets', ticket)).status, 'ok');
    await streams.kitchen.when(changeOf('kitchenTickets', t => t.id === ticket.id));
    await streams.cashier.when(changeOf('orders', x => x.id === o.id));

    // 3. The kitchen marks it ready: the waiter's device is told.
    await kitchen.load();
    const ready = { ...kitchen.doc('kitchenTickets', ticket.id), status: 'ready', readyAt: Date.now() };
    assert.equal((await kitchen.put('kitchenTickets', ready)).status, 'ok');
    await streams.waiter.when(changeOf('kitchenTickets', t => t.id === ticket.id && t.status === 'ready'));

    // 4. The cashier takes payment: the waiter sees the table close and the guest's menu is told to refresh.
    await cashier.load();
    const total = round2(5.6 * 1.07);
    const paid = await cashier.put('orders', { ...cashier.doc('orders', o.id), status: 'paid', totals: { total }, payment: { method: 'card' } });
    assert.equal(paid.status, 'ok', paid.error);
    await streams.waiter.when(changeOf('orders', x => x.id === o.id && x.status === 'paid'));
    await streams.guest.when(m => m.type === 'ping');
  } finally {
    Object.values(streams).forEach(s => s.close());
  }
});

test('two cashiers pressing "pay" on the same bill at the same moment: only one succeeds', async () => {
  const waiter = await login('Leo', '2222');
  const a = await login('Maya', '1111');
  const b = await login('Maya', '1111');
  const o = order(waiter, [['Espresso', 1]]);
  assert.equal((await waiter.put('orders', o)).status, 'ok');
  await Promise.all([a.load(), b.load()]);
  const attempt = dev => dev.put('orders', { ...dev.doc('orders', o.id), status: 'paid', totals: { total: 2.68 }, payment: { method: 'card' } });
  const results = await Promise.all([attempt(a), attempt(b)]);
  assert.deepEqual(results.map(r => r.status).sort(), ['conflict', 'ok']);
  const stored = app.db.doc('orders', o.id);
  assert.equal(stored.status, 'paid');
  assert.equal(stored.cashierId, a.user.id);
});

test('a device that was offline catches up on exactly what it missed', async () => {
  const waiter = await login('Leo', '2222');
  const cashier = await login('Maya', '1111');
  const { data: before } = await call('/api/snapshot', { token: waiter.token });

  // The waiter's phone drops off Wi-Fi; meanwhile the cashier keeps working.
  const made = await cashier.put('orders', order(cashier, [['Lemonade', 1]]));
  assert.equal(made.status, 'ok');

  const { data: missed } = await call('/api/changes?since=' + before.seq, { token: waiter.token });
  assert.ok(missed.rows.some(r => r.col === 'orders' && r.id === made.doc.id), 'the missed order is delivered');
  assert.ok(missed.rows.every(r => r.seq > before.seq), 'nothing old is repeated');

  // Work queued while offline applies if the phone's copy is still current…
  waiter.vers['orders/' + made.doc.id] = made.ver;
  assert.equal((await waiter.put('orders', { ...made.doc, note: 'queued while offline' })).status, 'ok');
  // …and a second editor working from an old copy is told to refresh instead of overwriting it.
  const stale = await cashier.put('orders', { ...made.doc, note: 'cashier edit from an old copy' });
  assert.equal(stale.status, 'conflict');
  assert.equal(stale.doc.note, 'queued while offline');
});

test('importing a backup tells every connected device to reload', async () => {
  const admin = await login('Admin', '1234');
  const waiter = await login('Leo', '2222');
  const s = await listen('/api/events?token=' + waiter.token);
  try {
    await s.when(m => m.type === 'hello');
    const exported = (await call('/api/export', { token: admin.token })).data;
    assert.equal((await call('/api/import', { token: admin.token, method: 'POST', body: exported })).status, 200);
    await s.when(m => m.type === 'reload');
  } finally { s.close(); }
});
