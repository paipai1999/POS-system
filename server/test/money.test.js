'use strict';

// Money formats (2 decimals, or whole kyat). Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');
const { computeTotals, roundTo, decimalsOf } = require('../../js/shared.js');

test('totals round to whole units when the money format has no decimals', () => {
  const order = { items: [{ price: 1500, qty: 3 }, { price: 750, qty: 1 }], discount: { type: 'percent', value: 10, by: 'x' } };
  const t = computeTotals(order, { taxRate: 5, serviceRate: 10, decimals: 0 });
  assert.deepEqual(t, { subtotal: 5250, discount: 525, serviceRate: 10, service: 473, taxRate: 5, tax: 260, total: 5458 });
  for (const v of [t.subtotal, t.discount, t.service, t.tax, t.total]) assert.ok(Number.isInteger(v), `${v} is a whole number`);
  assert.equal(computeTotals({ items: [{ price: 4, qty: 2 }] }, { taxRate: 7 }).total, 8.56, 'two decimals is still the default');
  assert.equal(decimalsOf({}), 2);
  assert.equal(decimalsOf({ decimals: 0 }), 0);
  assert.equal(roundTo(2.5, 0), 3);
  assert.equal(roundTo(1.005, 2), 1.01);
});

test('the server settles payments in the configured format', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-money-'));
  const app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (p, { token, method = 'GET', body } = {}) => {
    const res = await fetch(base + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    const users = (await call('/api/public')).data.users;
    const signIn = async (n, p) => (await call('/api/login', { method: 'POST', body: { userId: users.find(u => u.name === n).id, pin: p } })).data;
    const admin = await signIn('Admin', '1234');
    const maya = await signIn('Maya', '1111');
    const snap = async t => (await call('/api/snapshot', { token: t })).data.rows;
    const rows = await snap(admin.token);
    const settingsRow = rows.find(r => r.col === 'settings');
    const sync = async (token, change) => (await call('/api/sync', { token, method: 'POST', body: { changes: [change] } })).data.results[0];

    // An admin switches to kyat; the symbol is cleaned on the server too.
    const set = await sync(admin.token, { col: 'settings', id: 'main', base: settingsRow.ver, data: { ...settingsRow.data, currency: '<b>Ks', decimals: 0, currencyAfter: true, taxRate: 5 } });
    assert.equal(set.status, 'ok', set.error);
    assert.equal(set.doc.currency, 'bKs', 'markup characters are removed');
    assert.equal(set.doc.decimals, 0);
    assert.equal(set.doc.currencyAfter, true);
    assert.equal((await call('/api/public')).data.settings.decimals, 0, 'the login screen knows the format');
    const bad = await sync(admin.token, { col: 'settings', id: 'main', base: set.ver, data: { ...set.doc, decimals: 7, currencyAfter: 'yes' } });
    assert.equal(bad.doc.decimals, 2, 'unknown values fall back to 2 decimals');
    const fix = await sync(admin.token, { col: 'settings', id: 'main', base: bad.ver, data: { ...bad.doc, currency: 'Ks', decimals: 0, currencyAfter: true } });
    assert.equal(fix.status, 'ok');

    // A 3-item order of 1,500 Ks coffee + 5% tax = 4,725 Ks; cash 5,000 gives 275 change.
    const mayaRows = await snap(maya.token);
    const espresso = mayaRows.find(r => r.col === 'products' && r.data.name === 'Espresso').data;
    const order = { id: 'o_k1', number: null, tableId: null, tableName: '', staffId: maya.user.id, status: 'open', note: '', discount: null, createdAt: Date.now(),
      items: [{ id: 'l1', productId: espresso.id, name: 'Espresso', price: espresso.price, qty: 1, note: '', sentQty: 0 }] };
    const made = await sync(maya.token, { col: 'orders', id: order.id, base: 0, data: order });
    assert.equal(made.status, 'ok', made.error);
    const total = computeTotals(made.doc, fix.doc).total;
    assert.ok(Number.isInteger(total));
    const short = await sync(maya.token, { col: 'orders', id: order.id, base: made.ver, data: { ...made.doc, status: 'paid', totals: { total }, payment: { method: 'cash', tendered: total - 1 } } });
    assert.equal(short.status, 'error');
    const paid = await sync(maya.token, { col: 'orders', id: order.id, base: made.ver, data: { ...made.doc, status: 'paid', totals: { total }, payment: { method: 'cash', tendered: total + 1000.4 } } });
    assert.equal(paid.status, 'ok', paid.error);
    assert.equal(paid.doc.payment.tendered, total + 1000);
    assert.equal(paid.doc.payment.change, 1000);
  } finally {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
