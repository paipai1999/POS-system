'use strict';

// Daily database copies in the data folder plus up to two extra folders (a USB drive, a OneDrive/Google Drive
// folder, a second disk). A copy that stays on the same disk does not survive a failed disk, so the status
// says which folders are on a different disk and how fresh their newest copy is.
const fs = require('fs');
const path = require('path');

const MAX_EXTRA = 2;
const FILE = /^pos-\d{4}-\d{2}-\d{2}\.db$/;
const STALE_MS = 36 * 60 * 60 * 1000;

function createBackups({ db, dataDir, initialExtra = [] }) {
  const main = path.join(dataDir, 'backups');
  const errors = new Map(); // folder -> last error message

  const extraDirs = () => {
    const saved = db.meta('backupDirs', null);
    return saved || initialExtra;
  };

  const diskOf = dir => {
    try { return fs.statSync(dir).dev; } catch (e) {
      try { return fs.statSync(path.dirname(dir)).dev; } catch (e2) { return null; }
    }
  };

  function latest(dir) {
    try {
      const files = fs.readdirSync(dir).filter(f => FILE.test(f)).sort();
      if (!files.length) return { count: 0, newest: null };
      const newest = files[files.length - 1];
      return { count: files.length, newest, at: fs.statSync(path.join(dir, newest)).mtimeMs };
    } catch (e) {
      return { count: 0, newest: null };
    }
  }

  // Makes today's copy in every folder; a folder that is unavailable (USB unplugged) is retried at the next run.
  function run({ force = false } = {}) {
    for (const dir of [main, ...extraDirs()]) {
      try {
        db.backup(dir, { force, create: dir === main });
        errors.delete(dir);
      } catch (e) {
        errors.set(dir, e.code === 'ENOENT' ? 'Folder or drive not found' : e.message);
        console.error(`Backup to ${dir} failed: ${e.message}`);
      }
    }
  }

  function status() {
    const dataDisk = diskOf(dataDir);
    const row = (dir, kind) => {
      const l = latest(dir);
      const disk = diskOf(dir);
      return {
        path: dir, kind,
        offDisk: kind === 'extra' && disk !== null && dataDisk !== null && disk !== dataDisk,
        count: l.count, newest: l.newest, at: l.at || null,
        stale: !l.at || Date.now() - l.at > STALE_MS,
        error: errors.get(dir) || null,
      };
    };
    const folders = [row(main, 'main'), ...extraDirs().map(d => row(d, 'extra'))];
    return { folders, safe: folders.some(f => f.kind === 'extra' && f.offDisk && !f.stale && !f.error) };
  }

  // Replaces the extra folders after checking that each exists and can be written to.
  function setExtra(dirs) {
    if (!Array.isArray(dirs) || dirs.length > MAX_EXTRA) throw new Error(`At most ${MAX_EXTRA} extra folders`);
    const clean = [];
    for (const raw of dirs) {
      const dir = path.resolve(String(raw || '').trim());
      if (!String(raw || '').trim()) continue;
      if (!path.isAbsolute(String(raw).trim())) throw new Error(`"${raw}" is not a full folder path (for example D:\\POS-backups)`);
      let st;
      try { st = fs.statSync(dir); } catch (e) { throw new Error(`The folder ${dir} does not exist. Create it first, or plug in the drive.`); }
      if (!st.isDirectory()) throw new Error(`${dir} is not a folder`);
      const probe = path.join(dir, '.pos-write-test');
      try { fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe); } catch (e) { throw new Error(`Cannot write to ${dir}: ${e.message}`); }
      if (dir === path.resolve(main)) throw new Error('That is already the main backup folder');
      if (!clean.includes(dir)) clean.push(dir);
    }
    db.setMeta('backupDirs', clean);
    run();
    return status();
  }

  return { run, status, setExtra, main };
}

module.exports = { createBackups };
