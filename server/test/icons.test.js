'use strict';

// The icon set (js/ui/icons.js): every icon the screens ask for exists, and none is left as an emoji in the menu bar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/ui/icons.js'), 'utf8') + '\nthis.ICONS = ICONS; this.icon = icon;', ctx);

const sources = [];
(function walk(d) {
  for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    const rel = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') walk(rel); }
    else if (e.name.endsWith('.js') && !rel.includes(path.join('js', 'i18n'))) sources.push([rel, fs.readFileSync(path.join(root, rel), 'utf8')]);
  }
})('js');

test('every icon name used in the screens exists', () => {
  const missing = [];
  for (const [file, text] of sources) {
    for (const m of text.matchAll(/\bicon\('([a-z-]+)'/g)) if (!ctx.ICONS[m[1]]) missing.push(`${file}: ${m[1]}`);
    for (const m of text.matchAll(/\bcolumn\('([a-z-]+)'/g)) if (!ctx.ICONS[m[1]]) missing.push(`${file}: ${m[1]}`);
  }
  const registry = fs.readFileSync(path.join(root, 'js/app/registry.js'), 'utf8');
  for (const m of registry.matchAll(/icon: '([^']+)'/g)) if (!ctx.ICONS[m[1]]) missing.push(`registry: ${m[1]}`);
  assert.deepEqual(missing, []);
});

test('an icon is decorative markup that takes the text colour and a size in em', () => {
  const svg = ctx.icon('printer');
  assert.match(svg, /^<svg class="ico" viewBox="0 0 24 24" width="1\.15em" height="1\.15em"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.equal(ctx.icon('nope'), '', 'an unknown name draws nothing instead of breaking the screen');
  assert.match(ctx.icon('x', 2), /width="2em"/);
});

test('the menu bar items are icon names, not emoji', () => {
  const registry = fs.readFileSync(path.join(root, 'js/app/registry.js'), 'utf8');
  const icons = [...registry.matchAll(/icon: '([^']+)'/g)].map(m => m[1]);
  assert.ok(icons.length >= 10);
  for (const i of icons) assert.match(i, /^[a-z-]+$/);
});
