'use strict';

// "That PIN is already used by someone else" tells the caller about a colleague's PIN. The PIN-change endpoint therefore
// limits how often one person can try, so it cannot be used to read out everyone's PIN. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./support.js');

const MINUTE = 60 * 1000;

async function signIn(t, name, pin) {
  const users = (await t.call('/api/public')).data.users;
  const r = await t.call('/api/login', { method: 'POST', body: { userId: users.find(u => u.name === name).id, pin } });
  assert.equal(r.status, 200);
  return r.data.token;
}
const changePin = (t, token, pin) => t.call('/api/me/pin', { token, method: 'POST', body: { pin } });

// The admin chooses a private PIN, as the README tells them to; a waiter then goes looking for it.
async function adminWithPrivatePin(t, pin) {
  assert.equal((await changePin(t, await signIn(t, 'Admin', '1234'), pin)).status, 200);
}

test('after a few attempts a signed-in person is cut off, so they cannot search for a colleague\'s PIN', async () => {
  const t = await boot();
  try {
    await adminWithPrivatePin(t, '9317');
    const leo = await signIn(t, 'Leo', '2222');
    // Five tries are allowed (changing your own PIN a few times is normal)…
    for (const pin of ['8641', '8642', '8643', '8644', '8645']) assert.equal((await changePin(t, leo, pin)).status, 200, pin);
    // …then the endpoint stops answering, even for the admin's real PIN: it says nothing about it either way.
    const cut = await changePin(t, leo, '9317');
    assert.equal(cut.status, 429);
    assert.doesNotMatch(JSON.stringify(cut.data), /already used/);
    assert.equal((await changePin(t, leo, '9318')).status, 429, 'every further attempt is refused, not just the matching one');
  } finally { await t.stop(); }
});

test('before the limit a taken PIN is still refused, and the refusal is logged without the PIN', async () => {
  const t = await boot();
  try {
    await adminWithPrivatePin(t, '9317');
    const leo = await signIn(t, 'Leo', '2222');
    const taken = await changePin(t, leo, '9317');
    assert.equal(taken.status, 409);
    const rows = t.app.db.auditPage(50).filter(r => r.action === 'PIN change refused');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].target, 'Leo');
    assert.ok(!JSON.stringify(rows).includes('9317'), 'the log shows who is trying PINs, never which PIN');
    // The refused PIN did not change anything for Leo: his old PIN still signs him in.
    assert.equal((await t.call('/api/login', { method: 'POST', body: { userId: (await t.call('/api/public')).data.users.find(u => u.name === 'Leo').id, pin: '2222' } })).status, 200);
  } finally { await t.stop(); }
});

test('the limit is per person: a colleague can still change their own PIN', async () => {
  const t = await boot();
  try {
    const leo = await signIn(t, 'Leo', '2222');
    for (const pin of ['8641', '8642', '8643', '8644', '8645']) await changePin(t, leo, pin);
    assert.equal((await changePin(t, leo, '8646')).status, 429);
    const maya = await signIn(t, 'Maya', '1111');
    assert.equal((await changePin(t, maya, '7351')).status, 200);
  } finally { await t.stop(); }
});

test('PINs that are refused for being weak or malformed use up no attempts', async () => {
  const t = await boot();
  try {
    const leo = await signIn(t, 'Leo', '2222');
    for (const pin of ['0000', '1234', '12', 'abcd', '1234567', '5555', '1111', '3333']) {
      assert.equal((await changePin(t, leo, pin)).status, 400, pin);
    }
    for (const pin of ['8641', '8642', '8643', '8644', '8645']) assert.equal((await changePin(t, leo, pin)).status, 200, pin);
  } finally { await t.stop(); }
});

test('the limit lifts after ten minutes', async () => {
  const t = await boot();
  const realNow = Date.now;
  try {
    const leo = await signIn(t, 'Leo', '2222');
    for (const pin of ['8641', '8642', '8643', '8644', '8645']) await changePin(t, leo, pin);
    assert.equal((await changePin(t, leo, '8646')).status, 429);
    Date.now = () => realNow() + 11 * MINUTE;
    assert.equal((await changePin(t, leo, '8646')).status, 200);
  } finally { Date.now = realNow; await t.stop(); }
});
