'use strict';

// Dark mode and the bundled font. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');

const root = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('the dark theme re-defines every colour of the light theme', () => {
  const css = read('css/base.css');
  const light = css.match(/:root \{([\s\S]*?)\n\}/)[1];
  const dark = css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n  \}/)[1];
  const names = block => new Set([...block.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]));
  // Sizes and shapes are the same in both themes; every colour and fill must be listed again for dark.
  const same = new Set(['--radius', '--topbar-h', '--on-chrome', '--chrome-text', '--chrome-muted', '--danger-solid', '--ok-solid', '--warn-solid']);
  const missing = [...names(light)].filter(n => !names(dark).has(n) && !same.has(n));
  assert.deepEqual(missing, [], 'colours with no dark value');
});

test('no screen sets its own page colours with a bare hex, so the theme reaches everything', () => {
  // Hex values are allowed for: text on a coloured button (#fff), print sheets (#000 / #fff), and the colour tokens themselves.
  const files = [];
  const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).forEach(e => {
    if (e.isDirectory()) walk(path.join(d, e.name));
    else if (e.name.endsWith('.css')) files.push(path.join(d, e.name));
  });
  walk('css');
  const allowed = new Set(['#fff', '#000', '#ffffff']);
  const offenders = [];
  for (const f of files) {
    if (f.split(path.sep).join('/') === 'css/base.css') continue;
    read(f).split('\n').forEach((line, i) => {
      if (/^\s*\.(dot|sw|c\d)\b/.test(line) || /--c[0-5]:/.test(line) || /^\.(receipt|print-|qr-)/.test(line.trim())) return;
      for (const m of line.matchAll(/#[0-9a-fA-F]{3,6}\b/g)) {
        if (!allowed.has(m[0].toLowerCase())) offenders.push(`${f}:${i + 1} ${m[0]}`);
      }
    });
  }
  // The few that are intentionally fixed: status dots, chart palette, kitchen amber, the dashboard's stage stripe, the QR sheet, paper.
  const known = /dashboard\.css:\d+ #(?:6d28d9|c2410c|b45309|0f766e|1d4ed8|9ca3af)|kitchen\.css:\d+ #d97706|settings\.css:\d+ #(?:999|555)|finance\.css:\d+ #bbb|sync-status\.css:\d+ #(?:86efac|e7e0d6)|guest\.css:\d+ #e7e0d6/;
  assert.deepEqual(offenders.filter(o => !known.test(o)), []);
});

test('the font files are served with the right type, and every url() in fonts.css exists', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-font-'));
  const app = start({ port: 0, dataDir, quiet: true, allowDemoPins: true });
  await new Promise(r => app.server.once('listening', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const css = read('css/fonts.css');
    const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map(m => m[1]);
    assert.ok(urls.length >= 2);
    for (const u of urls) {
      const res = await fetch(`${base}/css/${u}`);
      assert.equal(res.status, 200, u);
      assert.equal(res.headers.get('content-type'), 'font/woff2');
      const buf = Buffer.from(await res.arrayBuffer());
      assert.equal(buf.subarray(0, 4).toString(), 'wOF2', 'a real woff2 file');
    }
    assert.equal((await fetch(`${base}/css/fonts/Inter-LICENSE.txt`)).status, 200, 'the licence ships with the font');
  } finally {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
