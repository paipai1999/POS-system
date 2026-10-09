'use strict';

// Routes that need no sign-in: server status, the sign-in screen's data, signing in, the guest menu and the printer stations.
// Each handler is (app, req, res, url); `app` holds db, auth, realtime… (see server.js).
const { hasDemoPin, pinMatches, DEMO_PINS } = require('../pins.js');
const rules = require('../rules');
const { HttpError, sendJSON, readJSON } = require('../http/util.js');
const { lanAddresses } = require('../network.js');

// What the sign-in screen needs: the shop name, money format and the names of active staff.
function publicInfo(db) {
  const settings = db.doc('settings', 'main');
  const users = db.all('users');
  return {
    settings: { name: settings.name, currency: settings.currency, decimals: settings.decimals, currencyAfter: settings.currencyAfter },
    users: users.filter(u => u.active).map(rules.stripUser),
    demo: users.some(u => u.role === 'admin' && hasDemoPin(u)),   // true while the admin still has the demo PIN
  };
}

const routes = {
  'GET /api/health': (app, req, res) =>
    sendJSON(res, 200, { ok: true, server: true, stations: app.realtime.stationCount(), addresses: lanAddresses(), port: app.server.address().port, https: !!app.tls }),

  'GET /api/public': (app, req, res) => sendJSON(res, 200, publicInfo(app.db)),

  'POST /api/login': async (app, req, res) => {
    const { db, auth } = app;
    const ip = req.socket.remoteAddress;
    auth.checkLock(ip);
    const { userId, pin } = await readJSON(req);
    const user = typeof userId === 'string' ? db.doc('users', userId) : null;
    if (!user || !user.active || !pinMatches(user, pin)) { auth.pinFailed(ip, user ? user.name : ''); throw new HttpError(401, 'Incorrect PIN'); }
    auth.clearFailures(ip);
    db.addAudit({ user, action: 'signed in', detail: `from ${ip}` });
    sendJSON(res, 200, { token: db.createSession(user.id), user: rules.stripUser(user), mustChangePin: hasDemoPin(user, DEMO_PINS) });
  },

  // A manager's PIN typed on someone else's session approves a void, refund or discount there.
  'POST /api/verify-pin': async (app, req, res, url) => {
    const { db, auth } = app;
    const ip = req.socket.remoteAddress;
    auth.checkLock(ip);
    const { pin } = await readJSON(req);
    const user = db.all('users').find(u => u.active && pinMatches(u, pin));
    if (!user) { auth.pinFailed(ip); throw new HttpError(401, 'Wrong PIN'); }
    const session = auth.authenticate(req, url);
    db.addAudit({ user: session ? session.user : null, action: 'manager PIN entered', target: user.name, detail: 'approval check' });
    auth.clearFailures(ip);
    if (session) auth.approve(session.token, user.id);
    sendJSON(res, 200, { user: rules.stripUser(user) });
  },

  // ----- guests scanning the QR code on a table -----
  'GET /api/guest/state': (app, req, res, url) => sendJSON(res, 200, rules.guestState(app.db, url.searchParams.get('table'))),

  'POST /api/guest/request': async (app, req, res) => {
    const body = await readJSON(req, 50000);
    const row = app.db.tx(() => rules.createGuestRequest(app.db, String(body.table || ''), body));
    app.realtime.broadcast([row]);
    sendJSON(res, 200, { ok: true });
  },

  'GET /api/guest/events': (app, req, res, url) => {
    const table = rules.tableByCode(app.db, url.searchParams.get('table'));
    if (!table) throw new HttpError(404, 'Unknown table');
    app.realtime.openStream(req, res, { kind: 'guest', tableId: table.id });
  },

  // ----- printer stations (a PC with a receipt printer, registered by an admin) -----
  'GET /api/station/events': (app, req, res, url) => {
    const { db, realtime } = app;
    const key = url.searchParams.get('key');
    if (!key || !realtime.stationKeys().includes(key)) throw new HttpError(403, 'This printer station is no longer registered');
    const client = realtime.openStream(req, res, { kind: 'station', key });
    const pending = db.where('printJobs', "json_extract(data, '$.status') = 'pending' AND json_extract(data, '$.createdAt') >= ?", Date.now() - 15 * 60 * 1000);
    realtime.send(client, { type: 'jobs', rows: pending });
    realtime.broadcastStations();
  },

  // A station claims a job ('printing') and then marks it 'done'; only one station can claim a job.
  'POST /api/station/job': async (app, req, res) => {
    const { db, realtime } = app;
    const { key, id, status } = await readJSON(req);
    if (!key || !realtime.stationKeys().includes(key)) throw new HttpError(403, 'This printer station is no longer registered');
    const row = db.tx(() => {
      const job = db.doc('printJobs', String(id));
      if (!job) throw new HttpError(404, 'Print job not found');
      const allowed = (status === 'printing' && job.status === 'pending') || (status === 'done' && job.status === 'printing');
      if (!allowed) throw new HttpError(409, 'Already handled by another station');
      return db.put('printJobs', job.id, { ...job, status, station: key.slice(0, 6), [status === 'done' ? 'printedAt' : 'claimedAt']: Date.now() });
    });
    realtime.broadcast([row]);
    sendJSON(res, 200, { ok: true });
  },
};

module.exports = routes;
