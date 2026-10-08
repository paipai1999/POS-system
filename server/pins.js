'use strict';

// PIN storage. A PIN is kept only as a salted scrypt hash ("scrypt$salt$hash"), never as the digits themselves.
// Note: a 4–6 digit PIN has few combinations, so a stolen database could still be brute-forced offline.
// Hashing keeps PINs out of plain sight (database file, backups, a glance over someone's shoulder at the file),
// while the 5-tries-then-30-seconds lock protects the live server.
const crypto = require('crypto');

const COST = { N: 4096, r: 8, p: 1 }; // ~10 ms per check, so comparing a PIN against every user stays quick
const KEY_LEN = 32;

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, KEY_LEN, COST);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// True when `pin` is the PIN of `user`. Also understands a not-yet-migrated plain `pin` field.
function pinMatches(user, pin) {
  if (!user) return false;
  pin = String(pin);
  if (typeof user.pinHash === 'string') {
    const [scheme, saltHex, hashHex] = user.pinHash.split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length, COST);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  if (typeof user.pin === 'string') {
    const a = Buffer.from(user.pin), b = Buffer.from(pin);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return false;
}

const hasPin = u => !!u && (typeof u.pinHash === 'string' || typeof u.pin === 'string');

// Rewrites every user that still has a plain PIN (old database, imported backup, demo data). Returns how many.
function migratePins(db) {
  let n = 0;
  db.tx(() => {
    for (const u of db.all('users')) {
      if (typeof u.pin !== 'string') continue;
      const { pin, ...rest } = u;
      db.put('users', u.id, { ...rest, pinHash: typeof u.pinHash === 'string' ? u.pinHash : hashPin(pin) });
      n++;
    }
  });
  // The old rows linger in SQLite's free pages and write-ahead log until they are overwritten, so compact the file.
  if (n) db.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
  return n;
}

// Whether `user` still has one of the demo PINs; cached per hash because the login page asks on every load.
const demoCache = new Map();
function hasDemoPin(user, demoPins = ['1234']) {
  if (!hasPin(user)) return false;
  const key = (user.pinHash || user.pin) + '|' + demoPins.join();
  if (!demoCache.has(key)) demoCache.set(key, demoPins.some(p => pinMatches(user, p)));
  return demoCache.get(key);
}

// PINs that ship with the demo data, and other guessable ones nobody should keep.
const DEMO_PINS = ['1234', '1111', '2222', '3333'];
const WEAK_PINS = new Set([...DEMO_PINS, '0000', '4321', '123456', '000000', '111111', '654321', '1212', '2580']);

module.exports = { hashPin, pinMatches, hasPin, migratePins, hasDemoPin, DEMO_PINS, WEAK_PINS };
