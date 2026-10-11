'use strict';

// Light / dark switch: on the sign-in screen and in the top bar, remembered on the device. Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, startServer, openApp } = require('./harness.js');

const opts = JSDOM ? {} : { skip: 'jsdom is not installed (run "npm install" once)' };

let srv;
const tabs = [];
test.before(async () => { if (JSDOM) srv = await startServer(); });
test.after(async () => {
  tabs.forEach(t => { try { t.close(); } catch (e) { /* already closed */ } });
  if (srv) await srv.stop();
});

test('the switch changes the page colours, stays after sign-in and is remembered', opts, async () => {
  const tab = await openApp(srv.base);
  tabs.push(tab);
  const theme = () => tab.get('document.documentElement.getAttribute("data-theme")');
  assert.equal(theme(), 'light', 'a device with no preference starts light');

  tab.click('[data-act=theme]');
  assert.equal(theme(), 'dark');
  assert.equal(tab.get('localStorage.getItem("pos-theme")'), 'dark');
  assert.equal(tab.get('document.querySelector("meta[name=theme-color]").getAttribute("content")'), '#0c0a08');
  assert.match(tab.get('document.querySelector(".theme-btn").title'), /light/i, 'the button now offers light');
  assert.ok(tab.$('.theme-btn svg'), 'the button shows an icon');

  await tab.signIn('Admin', '1234', '482915');
  assert.equal(theme(), 'dark', 'signing in does not reset it');
  assert.ok(tab.$('#topbar .theme-btn'), 'the switch is in the top bar');
  tab.click('#topbar [data-nav=theme]');
  assert.equal(theme(), 'light');
  assert.equal(tab.screen() === 'login', false, 'toggling does not navigate away');
  assert.equal(tab.get('localStorage.getItem("pos-theme")'), 'light');
});
