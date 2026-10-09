'use strict';

// Routes only an admin may use: backups, restoring a backup, the activity log and resetting to demo data.
// Each handler is (app, req, res, url, session).
const { seedData, isValidDataset, normalizeDataset } = require('../../js/shared.js');
const photos = require('../photos.js');
const { SECURITY_HEADERS, HttpError, sendJSON, readJSON } = require('../http/util.js');

const pad2 = n => String(n).padStart(2, '0');

const routes = {
  // The whole business as one JSON file (menu pictures are inside it, so it can be restored on another PC).
  'GET /api/export': (app, req, res, url, s) => {
    app.db.addAudit({ user: s.user, action: 'data exported', detail: 'full backup downloaded' });
    const d = new Date();
    const name = `pos-backup-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.json`;
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(photos.inlineDataset(app.dataDir, app.db.exportDataset()), null, 2));
  },

  // Replaces everything with the contents of a backup file.
  'POST /api/import': async (app, req, res, url, s) => {
    const data = await readJSON(req, 100e6);
    if (!isValidDataset(data)) throw new HttpError(400, 'That file is not a valid POS backup');
    app.db.loadDataset(photos.externalizeDataset(app.dataDir, normalizeDataset(data)));
    app.afterDataReplaced();
    app.db.addAudit({ user: s.user, action: 'backup imported', detail: `${data.orders.length} orders, ${data.users.length} staff replaced all data` });
    app.auth.forgetAll();
    app.realtime.broadcastReload();
    sendJSON(res, 200, { ok: true });
  },

  'GET /api/audit': (app, req, res, url) => {
    const before = Number(url.searchParams.get('before')) || undefined;
    const rows = app.db.auditPage(url.searchParams.get('limit'), before);
    sendJSON(res, 200, { rows, more: rows.length > 0 && app.db.auditPage(1, rows[rows.length - 1].id).length > 0 });
  },

  'GET /api/backup': (app, req, res) => sendJSON(res, 200, app.backups.status()),

  'POST /api/backup/run': (app, req, res) => {
    app.backups.run({ force: true });
    sendJSON(res, 200, app.backups.status());
  },

  'POST /api/backup/folders': async (app, req, res, url, s) => {
    const { dirs } = await readJSON(req);
    app.db.addAudit({ user: s.user, action: 'backup folders changed', detail: (Array.isArray(dirs) ? dirs : []).join(' | ') });
    try { sendJSON(res, 200, app.backups.setExtra(dirs)); } catch (e) { throw new HttpError(400, e.message); }
  },

  'POST /api/reset': (app, req, res, url, s) => {
    app.db.loadDataset(seedData());
    app.afterDataReplaced();
    app.db.addAudit({ user: s.user, action: 'data reset', detail: 'everything replaced by demo data' });
    app.auth.forgetAll();
    app.realtime.broadcastReload();
    sendJSON(res, 200, { ok: true });
  },
};

module.exports = routes;
