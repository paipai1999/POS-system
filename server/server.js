'use strict';

// Restaurant POS server: serves the web app to every device on the local network, stores data in SQLite
// and pushes changes to all devices live (Server-Sent Events). Uses only Node built-ins.
//
// Where things live:
//   routes/     the /api endpoints (public.js, staff.js, admin.js)        rules/     business rules for every change
//   http/       sending JSON, static files and photos                      db.js      SQLite storage
//   auth.js     sessions, PIN lock-out, manager approvals                 realtime.js live updates to devices
//   backups.js  daily copies of the database                               photos.js  menu pictures
require('./check-node.js');
const http = require('http');
const https = require('https');
const path = require('path');
const { seedData, normalizeDataset } = require('../js/shared.js');
const { Database } = require('./db.js');
const rules = require('./rules');
const { createBackups } = require('./backups.js');
const { migratePins } = require('./pins.js');
const photos = require('./photos.js');
const { createAuth } = require('./auth.js');
const { createRealtime } = require('./realtime.js');
const { loadTLS, lanAddresses } = require('./network.js');
const { HttpError, sendJSON } = require('./http/util.js');
const { serveStatic, servePhoto } = require('./http/static.js');
const { handleApi } = require('./routes');

// Every table needs the unguessable code printed in its QR link.
function ensureGuestCodes(db) {
  db.tx(() => {
    for (const t of db.all('tables')) if (!t.guestCode) db.put('tables', t.id, normalizeDataset({ tables: [t] }).tables[0]);
  });
}

function start({ port = 3000, dataDir = path.join(__dirname, 'data'), testDir = null, quiet = false } = {}) {
  const tls = loadTLS();
  const scheme = tls ? 'https' : 'http';
  const db = new Database(path.join(dataDir, 'pos.db'));
  if (db.isEmpty()) db.loadDataset(seedData());

  // Run after all data was replaced (first start, restoring a backup, resetting to demo data).
  const afterDataReplaced = () => {
    ensureGuestCodes(db);
    migratePins(db);                                  // PINs are only ever stored hashed; this converts demo data and databases from older versions
    db.tx(() => rules.refreshLacksDb(db, []));        // which dishes are short of an ingredient
  };
  afterDataReplaced();

  const backups = createBackups({ db, dataDir, initialExtra: process.env.POS_BACKUP_DIR ? [process.env.POS_BACKUP_DIR] : [] });
  const auth = createAuth(db);
  const realtime = createRealtime(db);

  // What the routes work with. `server` is filled in below, once the HTTP server exists.
  const app = { db, dataDir, tls, backups, auth, realtime, afterDataReplaced, server: null };

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(app, req, res, url);
      else if (req.method === 'GET' && url.pathname.startsWith('/photos/')) servePhoto(req, res, url, dataDir);
      else if (req.method === 'GET') serveStatic(req, res, url, { testDir });
      else throw new HttpError(405, 'Method not allowed');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof rules.Rejection ? 400 : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) sendJSON(res, status, { error: status === 500 ? 'Server error' : e.message });
      else res.end();
    }
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  app.server = server;

  // Work done now and then: clean old records, write repeating expenses that fell due, remove unused photos, copy the database.
  const heartbeat = setInterval(realtime.heartbeat, 25000);
  const housekeeping = () => {
    try { db.cleanup(); } catch (e) { console.error('Cleanup failed:', e.message); }
    try { realtime.broadcast(rules.runRecurringDb(db)); } catch (e) { console.error('Repeating expenses failed:', e.message); }
    try { photos.cleanup(dataDir, db.all('products').map(p => p.photo)); } catch (e) { console.error('Photo cleanup failed:', e.message); }
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
      realtime.closeAll();
      return new Promise(resolve => server.close(() => { db.close(); resolve(); }));
    },
  };
}

module.exports = { start };

// Started from the command line (start-server.bat / npm start).
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
