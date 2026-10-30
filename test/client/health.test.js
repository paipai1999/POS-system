'use strict';

// The warning mark in the menu bar and Settings → System health, in the real app. Needs jsdom:  npm install
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, startServer, openApp } = require('./harness.js');

const opts = JSDOM ? {} : { skip: 'jsdom is not installed (run "npm install" once)' };

let srv;
const tabs = [];
const open = async o => { const t = await openApp(srv.base, o); tabs.push(t); return t; };
test.before(async () => { if (JSDOM) srv = await startServer(); });
test.after(async () => {
  tabs.forEach(t => { try { t.close(); } catch (e) { /* already closed */ } });
  if (srv) await srv.stop();
});

test('an admin sees a mark in the menu bar, and System health explains each problem', opts, async () => {
  const t = await open();
  await t.signIn('Admin', '1234', '482915');
  await t.until(() => t.$('.health-chip'), { what: 'the warning mark' });
  assert.match(t.$('.health-chip').title, /different disk/);
  assert.match(t.$('.health-chip').getAttribute('aria-label'), /problems? to look at/);

  t.click('.health-chip');
  await t.until(() => t.screen() === 'settings', { what: 'the settings screen' });
  await t.until(() => t.$('[data-role=health] .facts'), { what: 'the health card' });
  const card = t.text('[data-role=health]');
  assert.match(card, /No recent backup is on a different disk or drive/);
  assert.match(card, /still use a PIN from the demo data/);
  for (const label of ['Version', 'Server running for', 'Free disk space', 'Last backup', 'Printer stations online']) assert.ok(card.includes(label), label);
  assert.match(card, /\d+ orders/);

  // "Check again" asks the server again and keeps the card up to date.
  t.click('[data-act=health-refresh]');
  await t.until(() => t.$('[data-role=health] .facts'), { what: 'the card after checking again' });
});

test('people who are not admins never see the mark', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '1111', '735192');
  await t.sleep(300);
  assert.equal(t.$('.health-chip'), null);
  assert.equal(t.get('App.healthWarnings.length'), 0);
});

test('the Myanmar interface shows the health card in Myanmar', opts, async () => {
  const t = await open({ lang: 'my' });
  await t.signIn('Admin', '482915');
  t.click('[data-nav=settings]');
  await t.until(() => t.$('[data-role=health] .facts'), { what: 'the health card' });
  const card = t.text('[data-role=health]');
  assert.ok(card.includes('ဗားရှင်း'), 'Version');
  assert.ok(card.includes('ဒစ်ခ်တွင် ကျန်သည့်နေရာ'), 'Free disk space');
});
