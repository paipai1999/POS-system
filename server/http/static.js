'use strict';

// Files the server hands out without any sign-in: the web app itself, and the menu photos.
const fs = require('fs');
const path = require('path');
const photos = require('../photos.js');
const { SECURITY_HEADERS, PAGE_CSP } = require('./util.js');

const ROOT = path.resolve(__dirname, '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const notFound = res => { res.writeHead(404, SECURITY_HEADERS); res.end('Not found'); };

// Menu photos are public (guests see them too). The name is random, so the answer can be cached for good.
function servePhoto(req, res, url, dataDir) {
  let name = '';
  try { name = decodeURIComponent(url.pathname.slice('/photos/'.length)); } catch (e) { /* not found below */ }
  const f = photos.read(dataDir, name);
  if (!f) return notFound(res);
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': f.type, 'Content-Length': f.buf.length, 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.end(f.buf);
}

// Only the app itself is served: index.html, css/ and js/ (never the server folder or the database).
// `testDir` (tests only) is an extra folder reachable under /__test/.
function serveStatic(req, res, url, { testDir = null } = {}) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { rel = ''; }
  if (rel === '/') rel = '/index.html';
  let base = ROOT;
  if (testDir && rel.startsWith('/__test/')) { base = path.resolve(testDir); rel = rel.slice('/__test'.length); }
  const file = path.resolve(base, '.' + rel);
  // Check the path AFTER "../" has been resolved (a check on the raw URL can be bypassed with "..%2f").
  const allowed = base === ROOT
    ? file === path.join(ROOT, 'index.html') || file.startsWith(path.join(ROOT, 'css') + path.sep) || file.startsWith(path.join(ROOT, 'js') + path.sep)
    : file.startsWith(base + path.sep);
  if (!allowed) return notFound(res);
  fs.readFile(file, (err, buf) => {
    if (err) return notFound(res);
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, {
      ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-cache',
      // No HSTS on purpose: with a self-signed certificate it would stop Chrome from offering "Continue anyway".
      ...(type.startsWith('text/html') ? { 'Content-Security-Policy': PAGE_CSP } : {}),
    });
    res.end(buf);
  });
}

module.exports = { servePhoto, serveStatic };
