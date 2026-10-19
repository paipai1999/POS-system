'use strict';

// The real web app against a server that gives a demo PIN nothing but the PIN change. Needs jsdom:  npm install
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, startServer, openApp } = require('./harness.js');

const opts = JSDOM ? {} : { skip: 'jsdom is not installed (run "npm install" once)' };

let srv;
const tabs = [];
test.before(async () => { if (JSDOM) srv = await startServer({ strict: true }); });
test.after(async () => {
  tabs.forEach(t => { try { t.close(); } catch (e) { /* already closed */ } });
  if (srv) await srv.stop();
});

test('with a demo PIN the app asks for a new PIN first, then loads everything', opts, async () => {
  const t = await openApp(srv.base); tabs.push(t);
  await t.pressPin('Admin', '1234');
  await t.until(() => t.modalTitle() === 'Choose your own PIN', { what: 'the PIN change dialog' });
  assert.equal(t.get('Store.data.tables.length'), 0, 'nothing is loaded behind the dialog');

  t.type('[name=pin]', '482915'); t.type('[name=again]', '482915');
  t.click('.modal [data-act=save]');
  await t.until(() => !t.get('Modal.isOpen'), { what: 'the dialog to close' });
  await t.until(() => t.get('Store.data.tables.length') > 0, { what: 'the tables to load' });
  assert.equal(t.screen(), 'tables');
  assert.ok(t.$$('[data-act=table]').length > 0, 'the table map shows the tables');
  assert.ok(t.$$('.nav-btn').length >= 6, 'the admin sees the full menu');
  assert.equal(t.get('Store.mustChangePin(App.user)'), false);
});

test('reloading the page while still on a demo PIN goes back to the sign-in screen', opts, async () => {
  const first = await openApp(srv.base); tabs.push(first);
  await first.pressPin('Maya', '1111');
  await first.until(() => first.modalTitle() === 'Choose your own PIN', { what: 'the PIN change dialog' });
  const token = first.get('Sync.token');
  assert.ok(token);

  // A page that comes back with that session finds nothing to restore (the server refuses it) and shows the sign-in screen.
  const again = await openApp(srv.base, { sessionToken: token }); tabs.push(again);
  await again.until(() => again.screen() === 'login', { what: 'the sign-in screen' });
  assert.equal(again.get('!!App.user'), false);
});
