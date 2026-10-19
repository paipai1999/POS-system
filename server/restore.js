'use strict';

// Puts a backup copy (pos-YYYY-MM-DD.db) back as the live database. Run it with the POS server stopped:
//
//   node server/restore.js --list                    shows the copies it can find, newest first
//   node server/restore.js "D:\POS-backups\pos-2026-10-12.db"
//
// Before anything is replaced the copy is opened and checked, and the data being replaced is saved next to it as
// before-restore-<date>.db, so a restore can itself be undone. (Windows: restore-backup.bat does the same.)
require('./check-node.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { DatabaseSync } = require('node:sqlite');
const { verifyCopy } = require('./db.js');

const COPY = /^pos-\d{4}-\d{2}-\d{2}\.db$/;
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// True when a POS server answers on this port of this PC.
function serverRunning(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1500 }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => { try { resolve(!!JSON.parse(body).server); } catch (e) { resolve(false); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// The extra backup folders the owner chose in Settings are kept inside the database itself.
function extraFolders(dataDir) {
  const live = path.join(dataDir, 'pos.db');
  if (!fs.existsSync(live)) return [];
  let db;
  try {
    db = new DatabaseSync(live);
    const row = db.prepare("SELECT v FROM meta WHERE k = 'backupDirs'").get();
    return row ? JSON.parse(row.v) : [];
  } catch (e) {
    return [];
  } finally {
    if (db) try { db.close(); } catch (e) { /* nothing to do */ }
  }
}

// Every backup copy in the data folder and the extra folders, newest first, each with what a check of it found.
function listBackups(dataDir, extra = extraFolders(dataDir)) {
  const out = [];
  for (const dir of [path.join(dataDir, 'backups'), ...extra]) {
    let names = [];
    try { names = fs.readdirSync(dir).filter(f => COPY.test(f)); } catch (e) { continue; }
    for (const name of names) {
      const file = path.join(dir, name);
      const st = fs.statSync(file);
      out.push({ file, name, dir, bytes: st.size, modified: st.mtimeMs, check: verifyCopy(file) });
    }
  }
  return out.sort((a, b) => b.name.localeCompare(a.name) || b.modified - a.modified);
}

// Replaces the live database with `file`. Throws an Error with a message fit to show the owner when it should not.
async function restore({ dataDir, file, port = 3000, now = new Date() }) {
  file = path.resolve(file);
  const live = path.join(dataDir, 'pos.db');
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  if (file === path.resolve(live)) throw new Error('That is the database the POS is using now. Choose a backup copy (see --list).');
  const check = verifyCopy(file);
  if (!check.ok) throw new Error(`That file cannot be used as a backup: ${check.error}`);
  if (await serverRunning(port)) throw new Error('The POS server is running. Close its window first, then run this again.');

  fs.mkdirSync(dataDir, { recursive: true });
  let safety = null;
  if (fs.existsSync(live)) {
    safety = path.join(dataDir, `before-restore-${stamp(now)}.db`);
    let cur;
    try {
      cur = new DatabaseSync(live);
      cur.exec(`VACUUM INTO '${safety.replace(/'/g, "''")}'`);     // a whole copy, including what is still in the write-ahead log
    } catch (e) {
      try { fs.copyFileSync(live, safety); } catch (e2) { throw new Error(`The current data could not be saved first, so nothing was changed: ${e2.message}`); }
    } finally {
      if (cur) try { cur.close(); } catch (e) { /* nothing to do */ }
    }
  }
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(live + ext, { force: true });
  fs.copyFileSync(file, live);

  // Menu pictures are not inside the database file; extra backup folders keep them in a "photos" folder beside the copies.
  let photos = 0;
  const from = path.join(path.dirname(file), 'photos');
  if (fs.existsSync(from)) {
    const to = path.join(dataDir, 'photos');
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from)) {
      if (!fs.existsSync(path.join(to, f))) { fs.copyFileSync(path.join(from, f), path.join(to, f)); photos++; }
    }
  }
  return { check, safety, photos };
}

module.exports = { restore, listBackups, extraFolders, serverRunning };

// ----- command line -----

const ask = q => new Promise(resolve => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, a => { rl.close(); resolve(a.trim()); });
});

async function main() {
  const args = process.argv.slice(2);
  const dataDir = process.env.POS_DATA_DIR || path.join(__dirname, 'data');
  const port = Number(process.env.PORT) || 3000;
  if (!args.length || args.includes('--list')) {
    const copies = listBackups(dataDir);
    if (!copies.length) console.log('\n  No backup copies were found in', path.join(dataDir, 'backups'), 'or the extra backup folders.\n');
    else {
      console.log('\n  Backup copies, newest first:\n');
      for (const c of copies) {
        const what = c.check.ok ? `${c.check.orders} orders, ${c.check.products} items, ${c.check.users} staff` : `DAMAGED: ${c.check.error}`;
        console.log(`  ${c.name}   ${(c.bytes / 1024 / 1024).toFixed(1)} MB   ${what}\n      ${c.file}`);
      }
      console.log('\n  To restore one:  node server\\restore.js "<full path of the file>"\n');
    }
    return;
  }
  const file = args.find(a => !a.startsWith('--'));
  const check = verifyCopy(path.resolve(file));
  if (check.ok && !args.includes('--yes')) {
    console.log(`\n  This copy has ${check.orders} orders, ${check.products} items and ${check.users} staff.`);
    console.log('  Everything the POS holds now will be replaced by it (a copy of the current data is kept first).');
    if ((await ask('  Type YES to continue: ')) !== 'YES') { console.log('\n  Nothing was changed.\n'); return; }
  }
  const r = await restore({ dataDir, file, port });
  console.log(`\n  Restored: ${r.check.orders} orders, ${r.check.products} items, ${r.check.users} staff.`);
  if (r.safety) console.log(`  The data that was replaced is saved as ${r.safety}`);
  if (r.photos) console.log(`  ${r.photos} menu picture(s) were copied back.`);
  console.log('  Now start the POS server again.\n');
}

if (require.main === module) {
  main().catch(e => { console.error('\n  ' + e.message + '\n'); process.exit(1); });
}
