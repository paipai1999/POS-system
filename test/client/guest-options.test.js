'use strict';

// A guest scans the table QR code, picks a dish with options, and the waiter accepts the order with those options.
// Needs jsdom:  npm install      Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, startServer, openApp } = require('./harness.js');

const opts = JSDOM ? {} : { skip: 'jsdom is not installed (run "npm install" once)' };

let srv;
const tabs = [];
const open = async o => { const t = await openApp(srv.base, o); tabs.push(t); return t; };
test.before(async () => {
  if (!JSDOM) return;
  srv = await startServer();
  const latte = srv.app.db.all('products').find(p => p.name === 'Latte');
  srv.app.db.put('products', latte.id, { ...latte, options: [{ name: 'Extra shot', price: 0.5 }, { name: 'Oat milk', price: 0.7 }] });
});
test.after(async () => {
  tabs.forEach(t => { try { t.close(); } catch (e) { /* already closed */ } });
  if (srv) await srv.stop();
});

const db = () => srv.app.db;
const latte = () => db().all('products').find(p => p.name === 'Latte');
const espresso = () => db().all('products').find(p => p.name === 'Espresso');

test('a guest picks options, sends the order, and the waiter sees and accepts it with them', opts, async () => {
  const table = db().all('tables')[0];
  const guest = await open({ path: '/?table=' + table.guestCode });
  await guest.until(() => guest.screen() === 'guest', { what: 'the guest menu' });

  // A dish with options says so; a plain dish does not.
  assert.match(guest.text(`.menu-card:has([data-id="${latte().id}"]) .price`), /^from \$4\.00$/);
  assert.equal(guest.text(`.menu-card:has([data-id="${espresso().id}"]) .price`), '$2.50');

  guest.click(`[data-act=add][data-id="${latte().id}"]`);
  await guest.until(() => /^Latte$/.test(guest.modalTitle() || ''), { what: 'the options' });
  assert.deepEqual(guest.$$('.modal .opt-row').map(r => r.textContent.replace(/\s+/g, ' ').trim()), ['Extra shot+$0.50', 'Oat milk+$0.70']);
  assert.equal(guest.text('.modal [data-role=sum]'), '$4.00');
  guest.click('.modal [name=opt][value="0"]');
  guest.click('.modal [name=opt][value="1"]');
  guest.$('.modal .opt-list').dispatchEvent(new guest.w.Event('change', { bubbles: true }));
  await guest.until(() => guest.text('.modal [data-role=sum]') === '$5.20', { what: 'the price with both options' });
  guest.click('.modal [data-act=add]');
  await guest.until(() => !guest.get('Modal.isOpen'));
  assert.equal(guest.$$('.menu-card .in-cart')[0].textContent, '1 added');

  // The same dish without options is a separate line.
  guest.click(`[data-act=add][data-id="${latte().id}"]`);
  await guest.until(() => /^Latte$/.test(guest.modalTitle() || ''));
  guest.click('.modal [data-act=add]');
  await guest.until(() => !guest.get('Modal.isOpen'));

  guest.click('[data-act=cart]');
  await guest.until(() => guest.modalTitle() === 'Your order');
  const lines = guest.$$('.modal .line').map(l => l.textContent.replace(/\s+/g, ' ').trim());
  assert.equal(lines.length, 2, 'two lines: with and without options');
  assert.ok(lines.some(l => /Latte\$5\.20 · \+ Extra shot, Oat milk/.test(l)), lines.join(' | '));
  assert.ok(lines.some(l => /Latte\$4\.00/.test(l) && !/Extra/.test(l)));
  guest.click('.modal [data-act=send]');
  await guest.until(() => guest.modalTitle() === 'Order sent', { what: 'the order to be sent' });

  const req = db().all('guestRequests').find(r => r.status === 'pending');
  assert.deepEqual(req.items.map(l => [l.price, (l.mods || []).map(m => m.name)]).sort(), [[4, []], [5.2, ['Extra shot', 'Oat milk']]]);

  // The waiter sees the options on the request and accepts it.
  const waiter = await open();
  await waiter.signIn('Leo', '2222', '618204');
  await waiter.until(() => waiter.$$('.request').length === 1, { what: 'the request card' });
  assert.match(waiter.text('.request'), /1 × Latte\s*\+ Extra shot, Oat milk/);
  waiter.click('.request [data-act=accept]');
  await waiter.until(() => db().all('orders').some(o => o.items.some(l => l.mods)), { what: 'the order with options' });
  const order = db().all('orders').find(o => o.items.some(l => l.mods));
  const withOptions = order.items.find(l => l.mods);
  assert.equal(withOptions.price, 5.2);
  assert.deepEqual(withOptions.mods, [{ name: 'Extra shot', price: 0.5 }, { name: 'Oat milk', price: 0.7 }]);
  assert.ok(order.items.some(l => !l.mods && l.price === 4), 'and the plain one without');
});

test('Myanmar: the options picker is translated', opts, async () => {
  const table = db().all('tables')[1];
  const guest = await open({ path: '/?table=' + table.guestCode, lang: 'my' });
  await guest.until(() => guest.screen() === 'guest');
  guest.click(`[data-act=add][data-id="${latte().id}"]`);
  await guest.until(() => guest.get('Modal.isOpen'));
  await guest.sleep(80);
  const latin = guest.$$('.modal .totals-inline span, .modal .btn').map(e => e.textContent.trim()).filter(x => /[A-Za-z]/.test(x));
  assert.deepEqual(latin, []);
});
