'use strict';

// Menu photos. The picture files live in <data folder>/photos with a random name; a menu item only stores that name.
// Names are random and never reused, so a photo can be cached forever by the browser.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NAME = /^[a-f0-9]{24}\.(jpg|png|webp)$/;
const MAX_BYTES = 2 * 1024 * 1024;   // the app sends a ~640px JPEG (usually under 150 KB); this is only the upper limit
const MAX_FILES = 1000;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

// What kind of picture the bytes really are (the file name and the Content-Type the sender claims are not trusted).
// SVG is refused on purpose: it can carry scripts.
function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

const dirOf = dataDir => path.join(dataDir, 'photos');
const list = dataDir => { try { return fs.readdirSync(dirOf(dataDir)).filter(f => NAME.test(f)); } catch (e) { return []; } };

// Stores one picture and returns its name. Throws an Error with a message that is fine to show the user.
function save(dataDir, buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('No picture was sent');
  if (buf.length > MAX_BYTES) throw new Error('That picture is too large (2 MB at most)');
  const ext = sniff(buf);
  if (!ext) throw new Error('Use a JPEG, PNG or WebP picture');
  if (list(dataDir).length >= MAX_FILES) throw new Error('Too many photos stored. Remove unused menu items first.');
  fs.mkdirSync(dirOf(dataDir), { recursive: true });
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(dirOf(dataDir), name), buf);
  return name;
}

const exists = (dataDir, name) => typeof name === 'string' && NAME.test(name) && fs.existsSync(path.join(dirOf(dataDir), name));

function read(dataDir, name) {
  if (typeof name !== 'string' || !NAME.test(name)) return null;
  try { return { buf: fs.readFileSync(path.join(dirOf(dataDir), name)), type: TYPES[name.split('.')[1]] }; } catch (e) { return null; }
}

// A backup file carries the pictures inside it (as data: URLs) so it can be restored on another PC.
function inlineDataset(dataDir, dataset) {
  for (const p of dataset.products || []) {
    if (!p.photo) continue;
    const f = read(dataDir, p.photo);
    if (f) p.photo = `data:${f.type};base64,${f.buf.toString('base64')}`;
    else delete p.photo;
  }
  return dataset;
}

// The reverse, for a restored backup (or one made in single-device mode): every data: URL becomes a file again, and a
// name that points to nothing is dropped.
function externalizeDataset(dataDir, dataset) {
  for (const p of dataset.products || []) {
    if (p.photo === undefined || p.photo === '') { delete p.photo; continue; }
    if (typeof p.photo === 'string') {
      const m = DATA_URL.exec(p.photo);
      if (m) {
        try { p.photo = save(dataDir, Buffer.from(m[1], 'base64')); continue; } catch (e) { delete p.photo; continue; }
      }
      if (exists(dataDir, p.photo)) continue;
    }
    delete p.photo;
  }
  return dataset;
}

// Deletes pictures no menu item uses. A picture is kept for a day first, so one that was just uploaded in the item
// editor (and not saved yet) is not removed under the user's hands.
function cleanup(dataDir, usedNames, now = Date.now()) {
  let removed = 0;
  const used = new Set(usedNames);
  for (const f of list(dataDir)) {
    if (used.has(f)) continue;
    const file = path.join(dirOf(dataDir), f);
    try {
      if (now - fs.statSync(file).mtimeMs < 24 * 60 * 60 * 1000) continue;
      fs.unlinkSync(file);
      removed++;
    } catch (e) { /* already gone */ }
  }
  return removed;
}

// Copies pictures that are not in the backup folder yet (they never change once written).
function copyTo(dataDir, backupDir) {
  const names = list(dataDir);
  if (!names.length) return;
  const target = path.join(backupDir, 'photos');
  fs.mkdirSync(target, { recursive: true });
  for (const f of names) {
    const to = path.join(target, f);
    if (!fs.existsSync(to)) fs.copyFileSync(path.join(dirOf(dataDir), f), to);
  }
}

module.exports = { NAME, MAX_BYTES, sniff, save, exists, read, inlineDataset, externalizeDataset, cleanup, copyTo, dirOf };
