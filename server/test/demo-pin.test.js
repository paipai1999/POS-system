'use strict';

// Someone who signs in with a PIN from the demo data can do nothing but choose their own PIN (or sign out), however they
// ask: the screen insists, but only the server can make it stick. These tests start the server the way it runs in a
// restaurant (every other test file opts out with allowDemoPins). Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');

let app, base, dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-demopin-'));
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(pathname, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const signIn = async (name, pin) => {
  const users = (await call('/api/public')).data.users;
  return call('/api/login', { method: 'POST', body: { userId: users.find(u => u.name === name).id, pin } });
};

test('with a demo PIN the server hands out nothing but the PIN change', async () => {
  const login = await signIn('Admin', '1234');
  assert.equal(login.status, 200);
  assert.equal(login.data.mustChangePin, true);
  const token = login.data.token;

  for (const [method, p, body] of [
    ['GET', '/api/snapshot'], ['GET', '/api/changes?since=0'], ['GET', '/api/orders'], ['GET', '/api/ledger'],
    ['GET', '/api/export'], ['GET', '/api/audit'], ['GET', '/api/backup'], ['GET', '/api/events'],
    ['POST', '/api/sync', { changes: [] }], ['POST', '/api/reset', {}], ['POST', '/api/import', {}],
    ['POST', '/api/station/register', {}], ['POST', '/api/orders/split', {}],
  ]) {
    const r = await call(p, { token, method, body });
    assert.equal(r.status, 403, `${method} ${p}`);
    assert.match(r.data.error, /choose your own PIN/);
  }
  // The token in the address bar (event streams) is no way round it either.
  assert.equal((await fetch(`${base}/api/events?token=${token}`)).status, 403);
});

test('choosing a PIN unlocks everything, and only for that person', async () => {
  const maya = (await signIn('Maya', '1111')).data;
  assert.equal(maya.mustChangePin, true);
  assert.equal((await call('/api/snapshot', { token: maya.token })).status, 403);

  assert.equal((await call('/api/me/pin', { token: maya.token, method: 'POST', body: { pin: '482915' } })).status, 200);
  const snap = await call('/api/snapshot', { token: maya.token });
  assert.equal(snap.status, 200);
  assert.equal(snap.data.mustChangePin, false);

  // Another person still on a demo PIN stays locked.
  const leo = (await signIn('Leo', '2222')).data;
  assert.equal((await call('/api/snapshot', { token: leo.token })).status, 403);
});

test('a person with a demo PIN can still sign out, and the old session is gone', async () => {
  const kitchen = (await signIn('Kitchen', '3333')).data;
  assert.equal((await call('/api/logout', { token: kitchen.token, method: 'POST' })).status, 200);
  assert.equal((await call('/api/me/pin', { token: kitchen.token, method: 'POST', body: { pin: '7391' } })).status, 401);
});

test('the PIN rules still apply: a demo PIN is not accepted as the new PIN', async () => {
  const leo = (await signIn('Leo', '2222')).data;
  assert.equal((await call('/api/me/pin', { token: leo.token, method: 'POST', body: { pin: '1234' } })).status, 400);
  assert.equal((await call('/api/snapshot', { token: leo.token })).status, 403, 'still locked');
});

test('the sign-in screen data and the guest menu need no PIN change', async () => {
  assert.equal((await call('/api/public')).status, 200);
  assert.equal((await call('/api/health')).status, 200);
});
