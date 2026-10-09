'use strict';

// Security headers and what the web server is willing to hand out. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { start } = require('../server.js');

let app, base, dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-sec-'));
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the page is served with a policy that only allows scripts from the server itself', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('strict-transport-security'), null, 'no HSTS: it would block self-signed certificates');
  const html = await res.text();
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'the page has no inline scripts, so the policy cannot break it');
  assert.ok(!/\son\w+=/i.test(html), 'and no inline event handlers');
});

test('API responses carry the basic headers', async () => {
  const res = await fetch(base + '/api/public');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('only the app files are served: never the database, server code or anything outside the folder', async () => {
  for (const p of ['/server/server.js', '/server/data/pos.db', '/server/pins.js', '/README.md', '/REPORT.md', '/.gitignore', '/package.json']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  assert.equal((await fetch(base + '/js/store/core.js')).status, 200);
  assert.equal((await fetch(base + '/css/base.css')).status, 200);

  // Path traversal has to be sent raw: fetch() would tidy "../" away before it leaves.
  const raw = target => new Promise((resolve, reject) => {
    const sock = net.connect(app.server.address().port, '127.0.0.1', () => sock.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
    let out = '';
    sock.on('data', d => { out += d; });
    sock.on('end', () => resolve(out.split('\r\n')[0]));
    sock.on('error', reject);
  });
  for (const t of ['/js/../server/server.js', '/js/%2e%2e/server/server.js', '/js/..%2fserver/server.js', '/js/..%2fserver%2fdata%2fpos.db', '/css/..%2f..%2f..%2fwindows%2fwin.ini', '/css/../../../../windows/win.ini']) {
    assert.match(await raw(t), / 404 /, t);
  }
});

test('the session token is not accepted in a way that lets other sites use it', async () => {
  const res = await fetch(base + '/api/snapshot', { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'no cross-origin access is granted');
});
