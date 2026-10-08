'use strict';

// Demo PINs must be replaced at first sign-in. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');

let app, base, dataDir;

async function call(pathname, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const userId = async name => (await call('/api/public')).data.users.find(u => u.name === name).id;
const signIn = async (name, pin) => call('/api/login', { method: 'POST', body: { userId: await userId(name), pin } });

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-pins-'));
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('signing in with a demo PIN is flagged, and the flag clears once the PIN is changed', async () => {
  const first = await signIn('Maya', '1111');
  assert.equal(first.status, 200);
  assert.equal(first.data.mustChangePin, true);
  const snap = await call('/api/snapshot', { token: first.data.token });
  assert.equal(snap.data.mustChangePin, true, 'a reloaded page is asked again');

  assert.equal((await call('/api/me/pin', { token: first.data.token, method: 'POST', body: { pin: '1111' } })).status, 400, 'the demo PIN is not accepted as the new PIN');
  for (const weak of ['0000', '4321', '7777', '12', 'abcd', '1234567']) {
    assert.equal((await call('/api/me/pin', { token: first.data.token, method: 'POST', body: { pin: weak } })).status, 400, weak);
  }
  assert.equal((await call('/api/me/pin', { token: first.data.token, method: 'POST', body: { pin: '2222' } })).status, 400, 'another demo PIN is refused too');
  assert.equal((await call('/api/me/pin', { method: 'POST', body: { pin: '4827' } })).status, 401, 'needs a session');

  const changed = await call('/api/me/pin', { token: first.data.token, method: 'POST', body: { pin: '4827' } });
  assert.equal(changed.status, 200);

  assert.equal((await signIn('Maya', '1111')).status, 401, 'old PIN stops working');
  const again = await signIn('Maya', '4827');
  assert.equal(again.status, 200);
  assert.equal(again.data.mustChangePin, false);
  assert.equal((await call('/api/snapshot', { token: again.data.token })).data.mustChangePin, false);
  assert.equal(app.db.doc('users', await userId('Maya')).pin, undefined);
});

test('a PIN already used by a colleague cannot be taken', async () => {
  const leo = (await signIn('Leo', '2222')).data;
  const res = await call('/api/me/pin', { token: leo.token, method: 'POST', body: { pin: '4827' } });
  assert.equal(res.status, 409);
});

test('the demo warning on the login screen goes away when no admin has a demo PIN', async () => {
  assert.equal((await call('/api/public')).data.demo, true);
  const admin = (await signIn('Admin', '1234')).data;
  assert.equal(admin.mustChangePin, true);
  assert.equal((await call('/api/me/pin', { token: admin.token, method: 'POST', body: { pin: '905173' } })).status, 200);
  assert.equal((await call('/api/public')).data.demo, false);
});
