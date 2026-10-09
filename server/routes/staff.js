'use strict';

// Routes for signed-in staff: loading data, saving changes, live updates, photos and their own PIN.
// Each handler is (app, req, res, url, session) where session = { token, user }.
const crypto = require('crypto');
const { hashPin, pinMatches, hasDemoPin, DEMO_PINS, WEAK_PINS } = require('../pins.js');
const photos = require('../photos.js');
const rules = require('../rules');
const { HttpError, sendJSON, readBody, readJSON } = require('../http/util.js');

const HISTORY_DAYS = 2;   // how many days of bills a device is sent at sign-in (older ones are fetched when a report needs them)

function historyStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (HISTORY_DAYS - 1));
  return d.getTime();
}

const needPerm = (user, perm) => { if (!rules.can(user, perm)) throw new HttpError(403, 'You do not have permission to do that'); };
const periodOf = url => ({ from: Number(url.searchParams.get('from')) || 0, to: Number(url.searchParams.get('to')) || Date.now() });

const routes = {
  // Everything a device needs at sign-in; `since` and `ledgerSince` tell it how far back orders and the money records go.
  'GET /api/snapshot': (app, req, res, url, s) => {
    const { db, realtime } = app;
    const since = historyStart();
    sendJSON(res, 200, {
      seq: db.meta('seq', 0), since, ledgerSince: db.ledgerSince(), stations: realtime.stationCount(), user: rules.stripUser(s.user), mustChangePin: hasDemoPin(s.user, DEMO_PINS),
      rows: rules.rowsFor(s.user, db.snapshotRows(since).map(rules.publicRow)),
    });
  },

  // Everything that changed after sequence number `since` (a device that was offline catches up with this).
  'GET /api/changes': (app, req, res, url, s) => {
    const since = Number(url.searchParams.get('since')) || 0;
    sendJSON(res, 200, { seq: app.db.meta('seq', 0), rows: rules.rowsFor(s.user, app.db.changesSince(since).map(rules.publicRow), { tombstone: true }) });
  },

  // Older bills, fetched when a report or the order history asks for a longer period.
  'GET /api/orders': (app, req, res, url, s) => {
    needPerm(s.user, 'orders');
    const { from, to } = periodOf(url);
    sendJSON(res, 200, { rows: rules.rowsFor(s.user, app.db.ordersBetween(from, to)) });
  },

  // Older purchases, supplier payments, stocktakes, expenses and owner money moves, fetched for the financial statements.
  'GET /api/ledger': (app, req, res, url, s) => {
    if (!rules.can(s.user, 'reports') && !rules.can(s.user, 'products')) throw new HttpError(403, 'You do not have permission to do that');
    const { from, to } = periodOf(url);
    sendJSON(res, 200, { rows: rules.rowsFor(s.user, app.db.ledgerBetween(from, to).map(rules.publicRow)) });
  },

  // A device sends its changes; each is checked by the rules and the answer says ok / conflict / error per change.
  'POST /api/sync': async (app, req, res, url, s) => {
    const { changes } = await readJSON(req, 5e6);
    if (!Array.isArray(changes) || changes.length > 1000) throw new HttpError(400, 'Invalid changes');
    const ctx = { user: s.user, hasApproval: id => app.auth.hasApproval(s.token, id) };
    const { results, changed } = rules.applyChanges(app.db, ctx, changes);
    app.realtime.broadcast(changed);
    sendJSON(res, 200, {
      seq: app.db.meta('seq', 0),
      results: results.map(r => r.col === 'users' && r.doc ? { ...r, doc: rules.stripUser(r.doc) } : r),
    });
  },

  'GET /api/events': (app, req, res, url, s) => {
    const client = app.realtime.openStream(req, res, { kind: 'staff', token: s.token, userId: s.user.id });
    app.realtime.send(client, { type: 'hello', seq: app.db.meta('seq', 0), stations: app.realtime.stationCount() });
  },

  // Moves some items of an open bill onto a new bill in one step (see rules/orders.js).
  'POST /api/orders/split': async (app, req, res, url, s) => {
    const body = await readJSON(req, 100000);
    const rows = app.db.tx(() => rules.splitOrder(app.db, { user: s.user }, body));
    app.realtime.broadcast(rows);
    sendJSON(res, 200, { rows: rows.map(rules.publicRow), seq: app.db.meta('seq', 0) });
  },

  // The picture itself (already shrunk by the app), sent as the raw request body.
  'POST /api/photo': async (app, req, res, url, s) => {
    needPerm(s.user, 'products');
    const buf = await readBody(req, photos.MAX_BYTES);
    let photo;
    try { photo = photos.save(app.dataDir, buf); } catch (e) { throw new HttpError(400, e.message); }
    sendJSON(res, 200, { photo });
  },

  // Every user may change their own PIN; this is also how a demo PIN gets replaced at first sign-in.
  'POST /api/me/pin': async (app, req, res, url, s) => {
    const { db } = app;
    app.auth.checkLock(req.socket.remoteAddress);
    const { pin } = await readJSON(req);
    const newPin = String(pin ?? '');
    if (!/^\d{4,6}$/.test(newPin)) throw new HttpError(400, 'PIN must be 4–6 digits');
    if (WEAK_PINS.has(newPin) || /^(\d)\1+$/.test(newPin)) throw new HttpError(400, 'That PIN is too easy to guess. Choose another.');
    const row = db.tx(() => {
      const me = db.doc('users', s.user.id);
      if (db.all('users').some(u => u.id !== me.id && pinMatches(u, newPin))) throw new HttpError(409, 'That PIN is already used by someone else');
      const { pin: legacy, ...rest } = me;
      return db.put('users', me.id, { ...rest, pinHash: hashPin(newPin) });
    });
    app.realtime.broadcast([row]);
    db.addAudit({ user: s.user, action: 'own PIN changed', target: s.user.name });
    sendJSON(res, 200, { ok: true });
  },

  'POST /api/logout': (app, req, res, url, s) => {
    app.db.deleteSession(s.token);
    app.auth.forget(s.token);
    app.realtime.endWhere(c => c.token === s.token);
    sendJSON(res, 200, { ok: true });
  },

  // ----- printer stations: an admin registers a PC to print receipts -----
  'POST /api/station/register': (app, req, res, url, s) => {
    if (!rules.can(s.user, 'settings')) throw new HttpError(403, 'Only an admin can set up a printer station');
    app.db.addAudit({ user: s.user, action: 'printer station added' });
    const key = crypto.randomBytes(18).toString('hex');
    app.db.setMeta('stationKeys', [...app.realtime.stationKeys(), key]);
    sendJSON(res, 200, { key });
  },

  'POST /api/station/unregister': async (app, req, res, url, s) => {
    if (!rules.can(s.user, 'settings')) throw new HttpError(403, 'Only an admin can remove a printer station');
    const { key } = await readJSON(req);
    app.db.addAudit({ user: s.user, action: 'printer station removed' });
    app.db.setMeta('stationKeys', app.realtime.stationKeys().filter(k => k !== key));
    app.realtime.endWhere(c => c.kind === 'station' && c.key === key);
    sendJSON(res, 200, { ok: true });
  },
};

module.exports = routes;
