'use strict';

// Loyalty: member levels, points that lapse, and a reward every Nth visit. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');
const { tierOf, customerDiscount, pointsOf, loyaltyEarn } = require('../../js/shared.js');

let app, base, dataDir;

async function call(pathname, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

class Device {
  constructor(token, user) { this.token = token; this.user = user; this.vers = {}; this.docs = {}; }
  async load() {
    const { data } = await call('/api/snapshot', { token: this.token });
    this.vers = {}; this.docs = {};
    for (const r of data.rows) { this.vers[r.col + '/' + r.id] = r.ver; this.docs[r.col + '/' + r.id] = r.data; }
  }
  doc(col, id) { return structuredClone(this.docs[col + '/' + id]); }
  find(col, pred) { return Object.entries(this.docs).filter(([k, d]) => k.startsWith(col + '/') && d && pred(d)).map(([, d]) => structuredClone(d)); }
  async put(col, doc, id = doc.id) {
    const change = { col, id, base: this.vers[col + '/' + id] || 0, data: doc };
    const { data } = await call('/api/sync', { token: this.token, method: 'POST', body: { changes: [change] } });
    const r = data.results[0];
    this.vers[col + '/' + id] = r.ver;
    this.docs[col + '/' + id] = r.doc;
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

const customer = id => app.db.doc('customers', id);
// The server alone owns spent / visits / last visit, so a test that needs "a long-standing customer" writes them directly.
const setHistory = (id, patch) => { const c = customer(id); app.db.put('customers', id, { ...c, ...patch }); };
const line = (dev, name, qty) => {
  const p = dev.find('products', x => x.name === name)[0];
  return { id: 'l_' + Math.random().toString(36).slice(2), productId: p.id, name: p.name, price: p.price, qty, note: '', sentQty: 0 };
};
const order = (dev, items, extra = {}) => ({
  id: 'o_' + Math.random().toString(36).slice(2), number: null, tableId: null, tableName: '', staffId: dev.user.id,
  status: 'open', note: '', discount: null, createdAt: Date.now(), items, ...extra,
});
const pay = (dev, o, total) => dev.put('orders', { ...dev.doc('orders', o.id), status: 'paid', totals: { total }, payment: { method: 'card' } });
const bill = async (cashier, customerId, discount = null, extra = {}) => {
  const o = (await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 5)], { customerId, discount, ...extra }))).doc;   // 20.00
  return o;
};
const without = (o, key) => { const { [key]: _, ...rest } = o; return rest; };

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-lvl-'));
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const LOYALTY = {
  enabled: true, earnPercent: 5, maxRedeemPercent: 50, expiryMonths: 6, visitReward: { every: 3, discountPercent: 20 },
  tiers: [{ name: 'Gold', minSpent: 300, earnPercent: 15, discountPercent: 10 }, { name: 'Silver', minSpent: 100, earnPercent: 10, discountPercent: 5 }],
};

test('the pure rules: levels, expiry, visit rewards', () => {
  const settings = { decimals: 2, loyalty: LOYALTY };
  assert.equal(tierOf({ spent: 99.99 }, settings), null);
  assert.equal(tierOf({ spent: 100 }, settings).name, 'Silver');
  assert.equal(tierOf({ spent: 5000 }, settings).name, 'Gold');
  assert.equal(tierOf({ spent: 5000 }, { loyalty: { ...LOYALTY, enabled: false } }), null);
  assert.equal(loyaltyEarn(20, settings, { spent: 0 }), 1);
  assert.equal(loyaltyEarn(20, settings, { spent: 150 }), 2);
  assert.equal(loyaltyEarn(20, settings, { spent: 400 }), 3);
  const noEarnOverride = { decimals: 2, loyalty: { ...LOYALTY, tiers: [{ name: 'Plain', minSpent: 0, earnPercent: null, discountPercent: 0 }] } };
  assert.equal(loyaltyEarn(20, noEarnOverride, { spent: 1 }), 1, 'a level with no % of its own uses the standard one');

  const now = Date.now();
  const month = 30.4375 * 86400000;
  assert.equal(pointsOf({ points: 40, lastVisit: now - 5 * month }, settings, now), 40);
  assert.equal(pointsOf({ points: 40, lastVisit: now - 7 * month }, settings, now), 0);
  assert.equal(pointsOf({ points: 40 }, settings, now), 40, 'never visited: nothing to lapse');
  assert.equal(pointsOf({ points: 40, lastVisit: 1 }, { loyalty: { ...LOYALTY, expiryMonths: 0 } }, now), 40, '0 months = never');

  assert.deepEqual(customerDiscount({ spent: 0, visits: 0 }, settings), { percent: 0, reason: null });
  assert.deepEqual(customerDiscount({ spent: 0, visits: 0, discountPercent: 8 }, settings), { percent: 8, reason: 'card' });
  assert.deepEqual(customerDiscount({ spent: 150, visits: 1 }, settings), { percent: 5, reason: 'level', tier: 'Silver' });
  assert.equal(customerDiscount({ spent: 150, visits: 1, discountPercent: 12 }, settings).percent, 12, 'the best one wins');
  assert.deepEqual(customerDiscount({ spent: 150, visits: 2 }, settings), { percent: 20, reason: 'visit' }, 'the 3rd visit');
  assert.equal(customerDiscount({ spent: 150, visits: 3 }, settings).percent, 5);
  assert.equal(customerDiscount({ spent: 150, visits: 5 }, settings).reason, 'visit', 'the 6th visit');
  assert.equal(customerDiscount({ spent: 0, visits: 2 }, { loyalty: { ...LOYALTY, enabled: false } }).percent, 0);
});

test('member levels, expiry and visit rewards are checked when saving the settings', async () => {
  const admin = await login('Admin', '1234');
  const s = admin.doc('settings', 'main');
  const trySettings = loyalty => admin.put('settings', { ...admin.doc('settings', 'main'), loyalty }, 'main');
  for (const bad of [
    { ...LOYALTY, tiers: [{ name: 'A', minSpent: 10 }, { name: 'A', minSpent: 20 }] },          // same name
    { ...LOYALTY, tiers: [{ name: 'A', minSpent: 10 }, { name: 'B', minSpent: 10 }] },          // same amount
    { ...LOYALTY, tiers: [{ name: '', minSpent: 10 }] },
    { ...LOYALTY, tiers: [{ name: 'A', minSpent: -5 }] },
    { ...LOYALTY, tiers: [{ name: 'A', minSpent: 10, discountPercent: 150 }] },
    { ...LOYALTY, tiers: [{ name: 'A', minSpent: 10, earnPercent: 101 }] },
    { ...LOYALTY, tiers: Array.from({ length: 7 }, (_, i) => ({ name: 'L' + i, minSpent: i * 10 })) },
    { ...LOYALTY, expiryMonths: -1 },
    { ...LOYALTY, visitReward: { every: -2, discountPercent: 10 } },
  ]) assert.equal((await trySettings(bad)).status, 'error', JSON.stringify(bad).slice(0, 80));
  const ok = await trySettings(LOYALTY);
  assert.equal(ok.status, 'ok', ok.error);
  assert.deepEqual(ok.doc.loyalty.tiers.map(t => t.name), ['Silver', 'Gold'], 'sorted by the amount spent');
  assert.equal(ok.doc.loyalty.expiryMonths, 6);
  assert.deepEqual(ok.doc.loyalty.visitReward, { every: 3, discountPercent: 20 });
  const { rows } = (await call('/api/audit', { token: admin.token })).data;
  assert.match(rows.find(r => r.action === 'settings changed').detail, /member levels changed \(Silver, Gold\)/);
  assert.ok(s);
});

test('a level changes what a customer earns and the discount they get; the 3rd visit is rewarded', async () => {
  const cashier = await login('Maya', '1111');
  const admin = await login('Admin', '1234');
  await cashier.load(); await admin.load();
  assert.equal((await admin.put('customers', { id: 'c_t', name: 'Tin Tin', phone: '0944', points: 30 })).status, 'ok');
  await cashier.load();

  // Visit 1: no level yet. 20.00 + 7% = 21.40, earns the standard 5% = 1.07.
  const o1 = await bill(cashier, 'c_t');
  const p1 = await pay(cashier, o1, 21.4);
  assert.equal(p1.status, 'ok', p1.error);
  assert.equal(p1.doc.loyalty.earned, 1.07);
  assert.equal(p1.doc.loyalty.tier, undefined);
  assert.equal(customer('c_t').points, 31.07);

  // The customer has now spent 150 over time: Silver (10% earn, 5% off). Visit 2.
  setHistory('c_t', { spent: 150 });
  await cashier.load();
  const wrong = await cashier.put('orders', { ...(await bill(cashier, 'c_t')), discount: { type: 'percent', value: 10, customerId: 'c_t' } }).catch(() => null);
  assert.ok(!wrong || wrong.status === 'error', 'not the level discount');
  const o2 = await bill(cashier, 'c_t', { type: 'percent', value: 5, customerId: 'c_t' });
  const p2 = await pay(cashier, o2, 20.33);      // 20 − 1.00 = 19.00 + 7% = 20.33
  assert.equal(p2.status, 'ok', p2.error);
  assert.equal(p2.doc.totals.discount, 1);
  assert.equal(p2.doc.loyalty.tier, 'Silver');
  assert.equal(p2.doc.loyalty.earned, 2.03, '10% of 20.33');
  assert.equal(customer('c_t').points, 33.1);
  assert.equal(customer('c_t').visits, 2);

  // Visit 3 is the rewarded one: 20% beats the level's 5%, and the lower figure is no longer accepted.
  await cashier.load();
  const o3 = await bill(cashier, 'c_t');
  assert.equal((await cashier.put('orders', { ...cashier.doc('orders', o3.id), discount: { type: 'percent', value: 5, customerId: 'c_t' } })).status, 'error');
  const reward = await cashier.put('orders', { ...cashier.doc('orders', o3.id), discount: { type: 'percent', value: 20, customerId: 'c_t' } });
  assert.equal(reward.status, 'ok', reward.error);
  const p3 = await pay(cashier, o3, 17.12);      // 20 − 4.00 = 16.00 + 7% = 17.12
  assert.equal(p3.status, 'ok', p3.error);
  assert.equal(p3.doc.loyalty.earned, 1.71);

  // Visit 4: back to the level discount.
  const o4 = await bill(cashier, 'c_t');
  assert.equal((await cashier.put('orders', { ...cashier.doc('orders', o4.id), discount: { type: 'percent', value: 20, customerId: 'c_t' } })).status, 'error');
  assert.equal((await cashier.put('orders', { ...cashier.doc('orders', o4.id), discount: { type: 'percent', value: 5, customerId: 'c_t' } })).status, 'ok');

  // A bigger spender reaches Gold: 15% earn.
  setHistory('c_t', { spent: 400 });
  const o5 = await bill(cashier, 'c_t');
  const before = customer('c_t').points;
  const p5 = await pay(cashier, o5, 21.4);
  assert.equal(p5.doc.loyalty.tier, 'Gold');
  assert.equal(p5.doc.loyalty.earned, 3.21, '15% of 21.40');
  assert.equal(customer('c_t').points, Math.round((before + 3.21) * 100) / 100);
});

test('points lapse after months without a visit; a refund brings them back', async () => {
  const cashier = await login('Maya', '1111');
  const admin = await login('Admin', '1234');
  assert.equal((await admin.put('customers', { id: 'c_old', name: 'Old Friend', phone: '0955', points: 30 })).status, 'ok');
  const long = Date.now() - 7 * 30.4375 * 86400000;
  setHistory('c_old', { lastVisit: long });
  await cashier.load();

  const o = await bill(cashier, 'c_old');
  const res = await cashier.put('orders', { ...cashier.doc('orders', o.id), pointsUsed: 5 });
  assert.equal(res.status, 'error');
  assert.match(res.error, /At most 0 points/, 'lapsed points cannot be spent');

  const paid = await pay(cashier, o, 21.4);
  assert.equal(paid.status, 'ok', paid.error);
  assert.equal(paid.doc.loyalty.expired, 30);
  assert.equal(paid.doc.loyalty.earned, 1.07);
  assert.equal(customer('c_old').points, 1.07, 'the lapsed 30 points are gone, the new 1.07 are kept');
  assert.ok(customer('c_old').lastVisit > long);

  await call('/api/verify-pin', { token: cashier.token, method: 'POST', body: { pin: '1234' } });
  assert.equal((await cashier.put('orders', { ...cashier.doc('orders', o.id), status: 'refunded', refundedBy: admin.user.id })).status, 'ok');
  assert.equal(customer('c_old').points, 30, 'the refund puts the lapsed points back');
  assert.equal(customer('c_old').lastVisit, long, 'and the visit date is as it was');
  assert.equal(customer('c_old').visits, 0);
  assert.ok(without(paid.doc.loyalty, 'prevLastVisit'));
});
