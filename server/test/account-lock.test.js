'use strict';

// Guessing a PIN is limited per person being guessed, not only per address: an address lock is no help against someone
// who changes address, or who signs in as themselves between guesses (a correct sign-in clears the address lock).
// Run with:  node --test server/test
//
// Every request in these tests comes from one address, so the lines "sign in as Leo" below are exactly that trick.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./support.js');

let users;
const idOf = name => users.find(u => u.name === name).id;

async function start() {
  const t = await boot();
  users = (await t.call('/api/public')).data.users;
  const login = (name, pin) => t.call('/api/login', { method: 'POST', body: { userId: idOf(name), pin } });
  const verify = (pin, token) => t.call('/api/verify-pin', { method: 'POST', body: { pin }, token });
  // Signs in as Leo (correct PIN), which clears the address lock the guesses build up.
  const resetAddressLock = async () => assert.equal((await login('Leo', '2222')).status, 200);
  // `n` wrong tries, never more than four in a row from the address (it is cleared before the first and after every fourth),
  // so that only the per-person lock can stop them.
  async function wrongTries(n, attempt) {
    for (let i = 0; i < n; i++) {
      if (i % 4 === 0) await resetAddressLock();
      assert.equal((await attempt()).status, 401);
    }
  }
  return { t, login, verify, resetAddressLock, wrongTries };
}

// Moves the clock the server sees forward.
function jumpAhead(ms) {
  const real = Date.now;
  Date.now = () => real() + ms;
  return () => { Date.now = real; };
}

test('signing in as yourself between guesses no longer gives unlimited guesses at someone else', async () => {
  const { t, login, wrongTries } = await start();
  try {
    await wrongTries(5, () => login('Maya', '0001'));
    const locked = await login('Maya', '1111');           // her real PIN: refused, so a guesser learns nothing
    assert.equal(locked.status, 429);
    assert.match(locked.data.error, /Too many wrong PINs for Maya\. Wait 30 seconds/);
    assert.equal((await login('Maya', '0001')).status, 429, 'and so is every other try');
  } finally { await t.stop(); }
});

test('only the person being guessed is locked', async () => {
  const { t, login, wrongTries } = await start();
  try {
    await wrongTries(5, () => login('Maya', '0001'));
    assert.equal((await login('Leo', '2222')).status, 200);
    assert.equal((await login('Admin', '1234')).status, 200);
  } finally { await t.stop(); }
});

test('people who are already signed in carry on working while their account is locked', async () => {
  const { t, login, wrongTries } = await start();
  try {
    const maya = (await login('Maya', '1111')).data.token;
    await wrongTries(5, () => login('Maya', '0001'));
    assert.equal((await login('Maya', '1111')).status, 429);
    assert.equal((await t.call('/api/snapshot', { token: maya })).status, 200);
  } finally { await t.stop(); }
});

test('the lock ends by itself, and the right PIN works again', async () => {
  const { t, login, wrongTries } = await start();
  let back;
  try {
    await wrongTries(5, () => login('Maya', '0001'));
    back = jumpAhead(29 * 1000);
    assert.equal((await login('Maya', '1111')).status, 429, 'still locked after 29 seconds');
    back(); back = jumpAhead(31 * 1000);
    assert.equal((await login('Maya', '1111')).status, 200);
  } finally { if (back) back(); await t.stop(); }
});

test('each time it happens again the lock lasts longer: 30 seconds, 1, 2 and then 5 minutes', async () => {
  const { t, login, wrongTries } = await start();
  let back, offset = 0;
  try {
    const waits = [];
    for (let round = 0; round < 5; round++) {
      await wrongTries(5, () => login('Maya', '0001'));
      const r = await login('Maya', '1111');
      assert.equal(r.status, 429);
      waits.push(r.data.error.match(/Wait (.+) and/)[1]);
      if (back) back();
      offset += 6 * 60 * 1000;                              // longer than any of the locks
      back = jumpAhead(offset);
    }
    assert.deepEqual(waits, ['30 seconds', '60 seconds', '2 minutes', '5 minutes', '5 minutes']);
  } finally { if (back) back(); await t.stop(); }
});

test('a correct sign-in starts the count again, and an hour of quiet forgets old mistakes', async () => {
  const { t, login, resetAddressLock } = await start();
  let back;
  try {
    for (let i = 0; i < 4; i++) assert.equal((await login('Maya', '0001')).status, 401);
    assert.equal((await login('Maya', '1111')).status, 200);               // clears her count (and the address count)
    for (let i = 0; i < 4; i++) assert.equal((await login('Maya', '0001')).status, 401);
    assert.equal((await login('Maya', '1111')).status, 200, 'four plus four wrong tries with a right one between is not eight in a row');

    for (let i = 0; i < 3; i++) assert.equal((await login('Maya', '0001')).status, 401);
    await resetAddressLock();                               // (the address count has no memory limit of its own)
    back = jumpAhead(61 * 60 * 1000);
    for (let i = 0; i < 2; i++) assert.equal((await login('Maya', '0001')).status, 401);   // 3 old + 2 new would be 5
    assert.equal((await login('Maya', '1111')).status, 200, 'the old mistakes are forgotten');
  } finally { if (back) back(); await t.stop(); }
});

test('a lock is written to the activity log, with the person and the address but never a PIN', async () => {
  const { t, login, wrongTries } = await start();
  try {
    await wrongTries(5, () => login('Maya', '0123'));
    const rows = t.app.db.auditPage(50).filter(r => r.action === 'account locked');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].target, 'Maya');
    assert.match(rows[0].detail, /5 wrong PINs in a row \(latest from .+\); locked for 30 seconds/);
    assert.ok(!JSON.stringify(rows).includes('0123'));
  } finally { await t.stop(); }
});

// ----- the manager-approval box (POST /api/verify-pin) -----

test('the approval box locks per signed-in person, and a colleague is not affected', async () => {
  const { t, login, verify, wrongTries } = await start();
  try {
    const leo = (await login('Leo', '2222')).data.token;
    const maya = (await login('Maya', '1111')).data.token;
    await wrongTries(5, () => verify('0001', leo));
    const locked = await verify('1234', leo);             // the admin's real PIN
    assert.equal(locked.status, 429);
    assert.match(locked.data.error, /entered from Leo's sign-in/);
    assert.equal((await verify('1234', maya)).status, 200, 'Maya\'s box still works');
    assert.equal((await t.call('/api/snapshot', { token: leo })).status, 200, 'and Leo can still work');
  } finally { await t.stop(); }
});

test('the approval box on a table tablet (nobody signed in) works, and has one shared lock', async () => {
  const { t, login, verify, wrongTries } = await start();
  try {
    const ok = await verify('1234');                       // a staff member leaving guest mode
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.name, 'Admin');

    await wrongTries(5, () => verify('0001'));
    const locked = await verify('1234');
    assert.equal(locked.status, 429);
    assert.match(locked.data.error, /entered here/);

    // The people who are signed in have their own box, which this does not touch.
    const leo = (await login('Leo', '2222')).data.token;
    assert.equal((await verify('1234', leo)).status, 200);
  } finally { await t.stop(); }
});

test('a locked approval box opens again after the wait', async () => {
  const { t, verify, wrongTries } = await start();
  let back;
  try {
    await wrongTries(5, () => verify('0001'));
    assert.equal((await verify('1234')).status, 429);
    back = jumpAhead(31 * 1000);
    assert.equal((await verify('1234')).status, 200);
  } finally { if (back) back(); await t.stop(); }
});

test('wrong tries on one box do not count against the other', async () => {
  const { t, login, verify, wrongTries } = await start();
  try {
    const leo = (await login('Leo', '2222')).data.token;
    await wrongTries(4, () => verify('0001', leo));
    await wrongTries(4, () => verify('0001'));              // the table tablet's box
    await wrongTries(4, () => login('Maya', '0001'));
    // None of the three reached five.
    assert.equal((await verify('1234', leo)).status, 200);
    assert.equal((await verify('1234')).status, 200);
    assert.equal((await login('Maya', '1111')).status, 200);
  } finally { await t.stop(); }
});
