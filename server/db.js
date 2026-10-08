'use strict';

// SQLite storage. Every entity (order, product, user…) is one JSON document with a version number
// and a global change sequence, so devices can fetch "everything changed since seq N".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { COLLECTIONS } = require('../js/shared.js');
const { hashPin } = require('./pins.js');

const SESSION_TTL = 12 * 60 * 60 * 1000;

class Database {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS docs (
        col TEXT NOT NULL,
        id TEXT NOT NULL,
        ver INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        data TEXT,
        PRIMARY KEY (col, id)
      );
      CREATE INDEX IF NOT EXISTS docs_seq ON docs (seq);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL);
    `);
    this.q = {
      get: this.db.prepare('SELECT * FROM docs WHERE col = ? AND id = ?'),
      upsert: this.db.prepare(`
        INSERT INTO docs (col, id, ver, seq, deleted, data) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (col, id) DO UPDATE SET ver = excluded.ver, seq = excluded.seq, deleted = excluded.deleted, data = excluded.data`),
      all: this.db.prepare('SELECT * FROM docs WHERE col = ? AND deleted = 0 ORDER BY rowid'),
      since: this.db.prepare('SELECT * FROM docs WHERE seq > ? ORDER BY seq'),
      getMeta: this.db.prepare('SELECT v FROM meta WHERE k = ?'),
      setMeta: this.db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v'),
      getSession: this.db.prepare('SELECT * FROM sessions WHERE token = ?'),
      addSession: this.db.prepare('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)'),
      delSession: this.db.prepare('DELETE FROM sessions WHERE token = ?'),
      delUserSessions: this.db.prepare('DELETE FROM sessions WHERE user_id = ?'),
      delOldSessions: this.db.prepare('DELETE FROM sessions WHERE created < ?'),
    };
  }

  close() { this.db.close(); }

  row(r) {
    return r ? { col: r.col, id: r.id, ver: r.ver, seq: r.seq, deleted: !!r.deleted, data: r.data ? JSON.parse(r.data) : null } : null;
  }

  get(col, id) { return this.row(this.q.get.get(col, id)); }
  doc(col, id) { const r = this.get(col, id); return r && !r.deleted ? r.data : null; }
  all(col) { return this.q.all.all(col).map(r => JSON.parse(r.data)); }
  changesSince(seq) { return this.q.since.all(seq).map(r => this.row(r)); }

  // Documents of one collection matching a SQL condition on the JSON data, e.g. "json_extract(data, '$.status') = ?".
  where(col, condition, ...params) {
    return this.db.prepare(`SELECT * FROM docs WHERE col = ? AND deleted = 0 AND (${condition}) ORDER BY rowid`)
      .all(col, ...params).map(r => this.row(r));
  }

  meta(k, def) { const r = this.q.getMeta.get(k); return r ? JSON.parse(r.v) : def; }
  setMeta(k, v) { this.q.setMeta.run(k, JSON.stringify(v)); }

  put(col, id, data, deleted = false) {
    const cur = this.q.get.get(col, id);
    const seq = this.meta('seq', 0) + 1;
    this.setMeta('seq', seq);
    const ver = (cur ? cur.ver : 0) + 1;
    this.q.upsert.run(col, id, ver, seq, deleted ? 1 : 0, deleted ? null : JSON.stringify(data));
    return { col, id, ver, seq, deleted, data: deleted ? null : data };
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  isEmpty() { return !this.q.get.get('settings', 'main'); }

  // Replaces all data (first start, import, reset). Order numbers continue above any existing ones.
  loadDataset(data) {
    this.tx(() => {
      this.db.exec('DELETE FROM docs; DELETE FROM sessions;');
      const settings = { ...data.settings };
      const maxNo = data.orders.reduce((m, o) => Math.max(m, Number(o.number) || 0), 0);
      this.setMeta('nextOrderNo', Math.max(Number(settings.nextOrderNo) || 1, maxNo + 1));
      delete settings.nextOrderNo;
      this.put('settings', 'main', settings);
      for (const col of COLLECTIONS) {
        for (const doc of data[col] || []) {
          if (col === 'users' && typeof doc.pin === 'string') { // demo data and old backups carry plain PINs: never write them
            const { pin, ...rest } = doc;
            this.put(col, doc.id, { ...rest, pinHash: typeof doc.pinHash === 'string' ? doc.pinHash : hashPin(pin) });
          } else this.put(col, doc.id, doc);
        }
      }
    });
  }

  exportDataset() {
    const out = { version: 1, settings: { ...this.doc('settings', 'main'), nextOrderNo: this.meta('nextOrderNo', 1) } };
    for (const col of COLLECTIONS) out[col] = this.all(col);
    return out;
  }

  // What a staff device needs at sign-in: menu, staff, tables, every open order and the recent history.
  snapshotRows(since) {
    return this.db.prepare(`
      SELECT * FROM docs WHERE deleted = 0 AND (
        col IN ('settings', 'users', 'categories', 'products', 'tables')
        OR (col = 'orders' AND (json_extract(data, '$.status') = 'open'
            OR json_extract(data, '$.createdAt') >= ? OR json_extract(data, '$.paidAt') >= ?))
        OR (col = 'guestRequests' AND (json_extract(data, '$.status') = 'pending' OR json_extract(data, '$.createdAt') >= ?))
        OR (col = 'kitchenTickets' AND (json_extract(data, '$.status') IN ('new', 'ready') OR json_extract(data, '$.createdAt') >= ?))
        OR (col = 'printJobs' AND json_extract(data, '$.status') IN ('pending', 'printing') AND json_extract(data, '$.createdAt') >= ?)
      ) ORDER BY rowid`).all(since, since, since, since, Date.now() - 30 * 60 * 1000).map(r => this.row(r));
  }

  ordersBetween(from, to) {
    return this.where('orders',
      "(json_extract(data, '$.createdAt') BETWEEN ? AND ?) OR (json_extract(data, '$.paidAt') BETWEEN ? AND ?)",
      from, to, from, to);
  }

  // ----- sessions (kept in the database so a server restart doesn't sign everyone out) -----
  createSession(userId) {
    const token = crypto.randomBytes(24).toString('hex');
    this.q.addSession.run(token, userId, Date.now());
    return token;
  }

  session(token) {
    if (!token) return null;
    const s = this.q.getSession.get(token);
    if (!s) return null;
    if (Date.now() - s.created > SESSION_TTL) { this.q.delSession.run(token); return null; }
    return { token: s.token, userId: s.user_id };
  }

  deleteSession(token) { this.q.delSession.run(token); }
  deleteUserSessions(userId) { this.q.delUserSessions.run(userId); }

  // ----- housekeeping -----
  cleanup() {
    this.q.delOldSessions.run(Date.now() - SESSION_TTL);
    // Print jobs hold a copy of a receipt; there is no need to keep them after a day.
    this.db.prepare("DELETE FROM docs WHERE col = 'printJobs' AND (deleted = 1 OR json_extract(data, '$.createdAt') < ?)")
      .run(Date.now() - 24 * 60 * 60 * 1000);
  }

  // One copy of the database per day, keeping the newest 30.
  // `create: false` is for folders on removable drives: a missing folder means the drive is gone, so don't recreate it on the wrong disk.
  backup(dir, { force = false, create = true } = {}) {
    if (create) fs.mkdirSync(dir, { recursive: true });
    else if (!fs.existsSync(dir)) throw Object.assign(new Error('Folder not found'), { code: 'ENOENT' });
    const d = new Date();
    const name = `pos-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.db`;
    const target = path.join(dir, name);
    if (fs.existsSync(target)) {
      if (!force) return null;
      fs.unlinkSync(target);
    }
    this.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const old = fs.readdirSync(dir).filter(f => /^pos-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -30);
    for (const f of old) fs.unlinkSync(path.join(dir, f));
    return target;
  }
}

module.exports = { Database };
