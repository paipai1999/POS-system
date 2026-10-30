'use strict';

// What an owner wants to know about the machine that runs the POS: is it healthy, is the data safe, is anything about to
// go wrong. Shown in Settings → System health, and as a warning mark in the menu bar for admins.
const fs = require('fs');
const path = require('path');
const { hasDemoPin, DEMO_PINS } = require('./pins.js');
const { lanAddresses } = require('./network.js');

const VERSION = require('../package.json').version;
const startedAt = Date.now();

const LOW_DISK_BYTES = 1024 ** 3;   // less than 1 GB free
const LOW_DISK_SHARE = 0.05;        // or less than 5% of the disk

const sizeOf = file => { try { return fs.statSync(file).size; } catch (e) { return 0; } };

function diskOf(dir) {
  try {
    const s = fs.statfsSync(dir);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch (e) {
    return null;
  }
}

const ago = ms => {
  const h = Math.round(ms / 3600000);
  return h < 48 ? `${Math.max(h, 1)} hour${h === 1 ? '' : 's'}` : `${Math.round(h / 24)} days`;
};

// Problems worth telling the owner about, worst first. Each is { level: 'error' | 'warn', code, text }.
function warningsFor({ backup, disk, demoUsers, now = Date.now() }) {
  const out = [];
  const add = (level, code, text) => out.push({ level, code, text });
  const main = backup.folders.find(f => f.kind === 'main');

  if (!main || !main.count) add('error', 'no-backup', 'No backup copy has been made yet.');
  else if (main.stale) add('warn', 'backup-old', `The newest backup on this PC is ${ago(now - main.at)} old. Backups are made every day while the server runs.`);

  for (const f of backup.folders) {
    if (f.check && !f.check.ok) add('error', 'backup-damaged', `The newest backup in ${f.path} is damaged: ${f.check.error}`);
    if (f.error) add('warn', 'backup-folder', `${f.path}: ${f.error}`);
    else if (f.kind === 'extra' && f.count && f.stale) add('warn', 'backup-folder-old', `The backup in ${f.path} is ${ago(now - f.at)} old.`);
  }
  if (!backup.safe) add('warn', 'same-disk', 'No recent backup is on a different disk or drive. If this PC\'s disk fails, the data and its backups are lost together.');

  if (disk && (disk.free < LOW_DISK_BYTES || disk.free / disk.total < LOW_DISK_SHARE)) {
    add('warn', 'disk-low', `Only ${(disk.free / 1024 ** 3).toFixed(1)} GB is free on this PC's disk. Free some space before it runs out.`);
  }
  if (demoUsers.length) {
    add('warn', 'demo-pins', `${demoUsers.length === 1 ? 'One person still uses' : demoUsers.length + ' people still use'} a PIN from the demo data (${demoUsers.join(', ')}). They cannot sign in to work until they choose their own.`);
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}

function systemInfo(app) {
  const { db, dataDir, backups, realtime, tls } = app;
  const file = db.file;
  const backup = backups.status();
  const disk = diskOf(dataDir);
  const demoUsers = db.all('users').filter(u => u.active && hasDemoPin(u, DEMO_PINS)).map(u => u.name);
  const newest = backup.folders.filter(f => f.at).sort((a, b) => b.at - a.at)[0];
  const count = col => db.db.prepare('SELECT COUNT(*) AS n FROM docs WHERE col = ? AND deleted = 0').get(col).n;
  return {
    version: VERSION,
    node: process.version,
    platform: process.platform,
    startedAt,
    uptimeMs: Date.now() - startedAt,
    https: !!tls,
    addresses: lanAddresses(),
    stations: realtime.stationCount(),
    data: {
      bytes: sizeOf(file) + sizeOf(file + '-wal'),
      orders: count('orders'), products: count('products'), customers: count('customers'), staff: count('users'),
    },
    disk,
    lastBackupAt: newest ? newest.at : null,
    backup,
    warnings: warningsFor({ backup, disk, demoUsers }),
  };
}

module.exports = { systemInfo, warningsFor, VERSION };
