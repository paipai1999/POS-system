'use strict';

// Restaurant POS server: serves the web app to every device on the local network, stores data in SQLite
// and pushes changes to all devices live (Server-Sent Events). Uses only Node built-ins.
require('./check-node.js');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { seedData, isValidDataset, normalizeDataset } = require('../js/shared.js');
const { Database } = require('./db.js');
const rules = require('./sync.js');
const { createBackups } = require('./backups.js');
const { pinMatches, migratePins, hasDemoPin, hashPin, DEMO_PINS, WEAK_PINS } = require('./pins.js');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const HISTORY_DAYS = 2;
const APPROVAL_TTL = 10 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// HTTPS is optional: it is used when a certificate and key exist (see README "HTTPS"), otherwise plain HTTP.
function loadTLS() {
  const dir = path.join(__dirname, 'certs');
  const keyFile = process.env.POS_TLS_KEY || path.join(dir, 'key.pem');
  const certFile = process.env.POS_TLS_CERT || path.join(dir, 'cert.pem');
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) return null;
  try { return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }; } catch (e) {
    console.error(`Could not read the HTTPS certificate (${e.message}); starting without HTTPS.`);
    return null;
  }
}

// Sent with every response. The page policy only allows scripts from this server, which also stops injected markup from running.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
}

function start({ port = 3000, dataDir = path.join(__dirname, 'data'), testDir = null, quiet = false } = {}) {
  const tls = loadTLS();
  const scheme = tls ? 'https' : 'http';
  const db = new Database(path.join(dataDir, 'pos.db'));
  if (db.isEmpty()) db.loadDataset(seedData());
  ensureGuestCodes(db);
  migratePins(db); // PINs are only ever stored hashed; this converts demo data and databases from older versions

  const backups = createBackups({ db, dataDir, initialExtra: process.env.POS_BACKUP_DIR ? [process.env.POS_BACKUP_DIR] : [] });

  const clients = new Set();       // open event streams: { res, kind: 'staff' | 'guest' | 'station', token?, tableId?, key? }
  const approvals = new Map();     // session token -> Map(managerId -> time the manager entered their PIN)
  const failures = new Map();      // ip -> { n, until } for PIN guessing protection

  // ----- helpers -----
  const sendJSON = (res, status, body) => {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const readJSON = (req, limit = 2e6) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });

  const checkLock = ip => {
    const f = failures.get(ip);
    if (f && f.until > Date.now()) throw new HttpError(429, 'Too many wrong PINs. Wait 30 seconds and try again.');
  };
  const pinFailed = ip => {
    const f = failures.get(ip) || { n: 0, until: 0 };
    f.n++;
    if (f.n >= 5) { f.n = 0; f.until = Date.now() + 30000; }
    failures.set(ip, f);
  };

  const authenticate = (req, url) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
    const s = db.session(token);
    if (!s) return null;
    const user = db.doc('users', s.userId);
    if (!user || !user.active) return null;
    return { token: s.token, user };
  };

  const stationKeys = () => db.meta('stationKeys', []);
  const stationCount = () => new Set([...clients].filter(c => c.kind === 'station').map(c => c.key)).size;

  const write = (c, msg) => { try { c.res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch (e) { clients.delete(c); } };

  // Staff devices get the changed documents; guests only a nudge to refetch their menu; printer stations only print jobs.
  function broadcast(rows) {
    if (!rows.length) return;
    const pub = rows.map(rules.publicRow);
    const seq = Math.max(...rows.map(r => r.seq));
    const jobs = pub.filter(r => r.col === 'printJobs');
    const users = new Map();     // one lookup per signed-in user, shared by all of their devices
    const guestRelevant = rows.some(r => !['printJobs', 'kitchenTickets', 'users'].includes(r.col));
    for (const c of clients) {
      if (c.kind === 'staff') {
        if (!users.has(c.userId)) users.set(c.userId, db.doc('users', c.userId));
        const visible = rules.rowsFor(users.get(c.userId), pub, { tombstone: true });
        if (visible.length) write(c, { type: 'change', seq, rows: visible });
      }
      else if (c.kind === 'station' && jobs.length) write(c, { type: 'jobs', rows: jobs });
      else if (c.kind === 'guest' && guestRelevant) write(c, { type: 'ping' });
    }
  }

  const broadcastStations = () => {
    const count = stationCount();
    for (const c of clients) if (c.kind === 'staff') write(c, { type: 'stations', count });
  };

  const broadcastReload = () => { for (const c of clients) write(c, { type: 'reload' }); };

  function openStream(req, res, client) {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    client.res = res;
    clients.add(client);
    req.on('close', () => {
      clients.delete(client);
      if (client.kind === 'station') broadcastStations();
    });
  }

  function publicInfo() {
    const settings = db.doc('settings', 'main');
    const users = db.all('users');
    return {
      settings: { name: settings.name, currency: settings.currency },
      users: users.filter(u => u.active).map(rules.stripUser),
      demo: users.some(u => u.role === 'admin' && hasDemoPin(u)),
    };
  }

  function historyStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (HISTORY_DAYS - 1));
    return d.getTime();
  }

  // ----- API -----
  async function api(req, res, url) {
    const ip = req.socket.remoteAddress;
    const route = `${req.method} ${url.pathname}`;

    // Public: no sign-in needed.
    switch (route) {
      case 'GET /api/health':
        return sendJSON(res, 200, { ok: true, server: true, stations: stationCount(), addresses: lanAddresses(), port: server.address().port, https: !!tls });
      case 'GET /api/public':
        return sendJSON(res, 200, publicInfo());
      case 'POST /api/login': {
        checkLock(ip);
        const { userId, pin } = await readJSON(req);
        const user = typeof userId === 'string' ? db.doc('users', userId) : null;
        if (!user || !user.active || !pinMatches(user, pin)) { pinFailed(ip); throw new HttpError(401, 'Incorrect PIN'); }
        failures.delete(ip);
        return sendJSON(res, 200, { token: db.createSession(user.id), user: rules.stripUser(user), mustChangePin: hasDemoPin(user, DEMO_PINS) });
      }
      case 'POST /api/verify-pin': {
        checkLock(ip);
        const { pin } = await readJSON(req);
        const user = db.all('users').find(u => u.active && pinMatches(u, pin));
        if (!user) { pinFailed(ip); throw new HttpError(401, 'Wrong PIN'); }
        failures.delete(ip);
        const s = authenticate(req, url);
        if (s) {
          if (!approvals.has(s.token)) approvals.set(s.token, new Map());
          approvals.get(s.token).set(user.id, Date.now());
        }
        return sendJSON(res, 200, { user: rules.stripUser(user) });
      }
      case 'GET /api/guest/state':
        return sendJSON(res, 200, rules.guestState(db, url.searchParams.get('table')));
      case 'POST /api/guest/request': {
        const body = await readJSON(req, 50000);
        const row = db.tx(() => rules.createGuestRequest(db, String(body.table || ''), body));
        broadcast([row]);
        return sendJSON(res, 200, { ok: true });
      }
      case 'GET /api/guest/events': {
        const table = rules.tableByCode(db, url.searchParams.get('table'));
        if (!table) throw new HttpError(404, 'Unknown table');
        return openStream(req, res, { kind: 'guest', tableId: table.id });
      }
      case 'GET /api/station/events': {
        const key = url.searchParams.get('key');
        if (!key || !stationKeys().includes(key)) throw new HttpError(403, 'This printer station is no longer registered');
        openStream(req, res, { kind: 'station', key });
        const pending = db.where('printJobs', "json_extract(data, '$.status') = 'pending' AND json_extract(data, '$.createdAt') >= ?", Date.now() - 15 * 60 * 1000);
        write([...clients].find(c => c.res === res), { type: 'jobs', rows: pending });
        broadcastStations();
        return;
      }
      case 'POST /api/station/job': {
        const { key, id, status } = await readJSON(req);
        if (!key || !stationKeys().includes(key)) throw new HttpError(403, 'This printer station is no longer registered');
        const row = db.tx(() => {
          const job = db.doc('printJobs', String(id));
          if (!job) throw new HttpError(404, 'Print job not found');
          const allowed = (status === 'printing' && job.status === 'pending') || (status === 'done' && job.status === 'printing');
          if (!allowed) throw new HttpError(409, 'Already handled by another station');
          return db.put('printJobs', job.id, { ...job, status, station: key.slice(0, 6), [status === 'done' ? 'printedAt' : 'claimedAt']: Date.now() });
        });
        broadcast([row]);
        return sendJSON(res, 200, { ok: true });
      }
    }

    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
    const s = authenticate(req, url);
    if (!s) throw new HttpError(401, 'Please sign in again');
    const isAdmin = rules.can(s.user, 'settings');

    switch (route) {
      case 'GET /api/snapshot': {
        const since = historyStart();
        return sendJSON(res, 200, {
          seq: db.meta('seq', 0), since, stations: stationCount(), user: rules.stripUser(s.user), mustChangePin: hasDemoPin(s.user, DEMO_PINS),
          rows: rules.rowsFor(s.user, db.snapshotRows(since).map(rules.publicRow)),
        });
      }
      case 'GET /api/changes': {
        const since = Number(url.searchParams.get('since')) || 0;
        return sendJSON(res, 200, { seq: db.meta('seq', 0), rows: rules.rowsFor(s.user, db.changesSince(since).map(rules.publicRow), { tombstone: true }) });
      }
      case 'GET /api/orders': {
        if (!rules.can(s.user, 'orders')) throw new HttpError(403, 'You do not have permission to do that');
        const from = Number(url.searchParams.get('from')) || 0;
        const to = Number(url.searchParams.get('to')) || Date.now();
        return sendJSON(res, 200, { rows: rules.rowsFor(s.user, db.ordersBetween(from, to)) });
      }
      case 'POST /api/sync': {
        const { changes } = await readJSON(req, 5e6);
        if (!Array.isArray(changes) || changes.length > 1000) throw new HttpError(400, 'Invalid changes');
        const ctx = {
          user: s.user,
          hasApproval: id => {
            const t = approvals.get(s.token)?.get(id);
            return !!t && Date.now() - t < APPROVAL_TTL;
          },
        };
        const { results, changed } = rules.applyChanges(db, ctx, changes);
        broadcast(changed);
        return sendJSON(res, 200, {
          seq: db.meta('seq', 0),
          results: results.map(r => r.col === 'users' && r.doc ? { ...r, doc: rules.stripUser(r.doc) } : r),
        });
      }
      case 'GET /api/events':
        openStream(req, res, { kind: 'staff', token: s.token, userId: s.user.id });
        write([...clients].find(c => c.res === res), { type: 'hello', seq: db.meta('seq', 0), stations: stationCount() });
        return;
      case 'POST /api/me/pin': {
        // Every user may change their own PIN; this is also how a demo PIN gets replaced at first sign-in.
        checkLock(ip);
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
        broadcast([row]);
        return sendJSON(res, 200, { ok: true });
      }
      case 'POST /api/logout':
        db.deleteSession(s.token);
        approvals.delete(s.token);
        for (const c of clients) if (c.token === s.token) c.res.end();
        return sendJSON(res, 200, { ok: true });
      case 'POST /api/station/register': {
        if (!isAdmin) throw new HttpError(403, 'Only an admin can set up a printer station');
        const key = crypto.randomBytes(18).toString('hex');
        db.setMeta('stationKeys', [...stationKeys(), key]);
        return sendJSON(res, 200, { key });
      }
      case 'POST /api/station/unregister': {
        if (!isAdmin) throw new HttpError(403, 'Only an admin can remove a printer station');
        const { key } = await readJSON(req);
        db.setMeta('stationKeys', stationKeys().filter(k => k !== key));
        for (const c of clients) if (c.kind === 'station' && c.key === key) c.res.end();
        return sendJSON(res, 200, { ok: true });
      }
    }

    if (!isAdmin) throw new HttpError(403, 'Only an admin can do that');
    switch (route) {
      case 'GET /api/export': {
        const d = new Date();
        const name = `pos-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(db.exportDataset(), null, 2));
      }
      case 'POST /api/import': {
        const data = await readJSON(req, 100e6);
        if (!isValidDataset(data)) throw new HttpError(400, 'That file is not a valid POS backup');
        db.loadDataset(normalizeDataset(data));
        ensureGuestCodes(db);
        migratePins(db);
        approvals.clear();
        broadcastReload();
        return sendJSON(res, 200, { ok: true });
      }
      case 'GET /api/backup':
        return sendJSON(res, 200, backups.status());
      case 'POST /api/backup/run':
        backups.run({ force: true });
        return sendJSON(res, 200, backups.status());
      case 'POST /api/backup/folders': {
        const { dirs } = await readJSON(req);
        try { return sendJSON(res, 200, backups.setExtra(dirs)); } catch (e) { throw new HttpError(400, e.message); }
      }
      case 'POST /api/reset':
        db.loadDataset(seedData());
        migratePins(db);
        approvals.clear();
        broadcastReload();
        return sendJSON(res, 200, { ok: true });
    }
    throw new HttpError(404, 'Not found');
  }

  // ----- static files: only the app itself (never the server folder or the database) -----
  function serveStatic(req, res, url) {
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch (e) { rel = ''; }
    if (rel === '/') rel = '/index.html';
    let base = ROOT;
    if (testDir && rel.startsWith('/__test/')) { base = path.resolve(testDir); rel = rel.slice('/__test'.length); }
    else if (!/^\/(index\.html|css\/|js\/)/.test(rel)) { res.writeHead(404); return res.end('Not found'); }
    const file = path.resolve(base, '.' + rel);
    if (!file.startsWith(base + path.sep)) { res.writeHead(404); return res.end('Not found'); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      const type = MIME[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, {
        ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-cache',
        ...(type.startsWith('text/html') ? { 'Content-Security-Policy': PAGE_CSP } : {}),
        ...(tls ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
      });
      res.end(buf);
    });
  }

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'GET') serveStatic(req, res, url);
      else throw new HttpError(405, 'Method not allowed');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof rules.Rejection ? 400 : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) sendJSON(res, status, { error: status === 500 ? 'Server error' : e.message });
      else res.end();
    }
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

  // Keep event streams alive through Wi-Fi power saving and proxies.
  const heartbeat = setInterval(() => { for (const c of clients) { try { c.res.write(': hb\n\n'); } catch (e) { clients.delete(c); } } }, 25000);
  const housekeeping = () => {
    try { db.cleanup(); } catch (e) { console.error('Cleanup failed:', e.message); }
    backups.run();
  };
  housekeeping();
  const hourly = setInterval(housekeeping, 60 * 60 * 1000);

  server.listen(port, '0.0.0.0', () => {
    if (quiet) return;
    const p = server.address().port;
    console.log('\n  Restaurant POS server is running.\n');
    console.log(`  On this PC:     ${scheme}://localhost:${p}`);
    for (const a of lanAddresses()) console.log(`  Other devices:  ${scheme}://${a}:${p}`);
    console.log(`\n  Data: ${path.join(dataDir, 'pos.db')}`);
    console.log('  Keep this window open. Press Ctrl+C to stop.\n');
  });

  return {
    server,
    db,
    close() {
      clearInterval(heartbeat);
      clearInterval(hourly);
      for (const c of clients) c.res.end();
      clients.clear();
      return new Promise(resolve => server.close(() => { db.close(); resolve(); }));
    },
  };
}

function ensureGuestCodes(db) {
  db.tx(() => {
    for (const t of db.all('tables')) if (!t.guestCode) db.put('tables', t.id, normalizeDataset({ tables: [t] }).tables[0]);
  });
}

module.exports = { start };

if (require.main === module) {
  const app = start({
    port: Number(process.env.PORT) || 3000,
    dataDir: process.env.POS_DATA_DIR || path.join(__dirname, 'data'),
    testDir: process.env.POS_TEST_DIR || null,
  });
  app.server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  Port ${e.port} is already in use — is the POS server already running?\n`);
      process.exit(2); // start-server.bat does not restart on 2
    }
    console.error(e);
    process.exit(1);
  });
  const stop = () => { app.close().then(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
