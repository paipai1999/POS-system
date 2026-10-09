'use strict';

// The Myanmar word list and translation rules (no browser needed). Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
global.document = { documentElement: {} };
// Loads the translator and the Myanmar word list files in the order index.html loads them.
const load = () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const files = [...html.matchAll(/src="(js\/i18n\/[^"]+)"/g)].map(m => m[1]);
  const code = files.map(f => fs.readFileSync(path.join(root, f), 'utf8').replace('const I18N =', 'globalThis.I18N =')).join('\n');
  new Function(code)();
  return globalThis.I18N;
};
const I18N = load();
const MYANMAR = /[က-႟]/;

test('every word-list entry has a Myanmar translation', () => {
  const bad = Object.entries(I18N.dict).filter(([en, my]) => typeof my !== 'string' || !my.trim() || !MYANMAR.test(my));
  // A few entries are meant to keep Latin text only (e.g. brand names); none should be empty.
  assert.deepEqual(bad.filter(([, my]) => !String(my).trim()), []);
  assert.deepEqual(bad.map(([en]) => en).filter(en => /[A-Za-z]{4,}/.test(en) && !/^(OK|ok)$/.test(en)), [], 'English sentences must be translated into Myanmar script');
});

test('every pattern is a regular expression with a template that only uses groups it captures', () => {
  for (const [re, tpl] of I18N.patterns) {
    assert.ok(re instanceof RegExp, String(re));
    const groups = new RegExp(re.source + '|').exec('').length - 1;
    for (const ref of tpl.matchAll(/\$(\d)/g)) assert.ok(+ref[1] <= groups, `${re} uses $${ref[1]} but captures ${groups}`);
    // Either Myanmar text, or just the captured parts (each is translated on its own, e.g. "Admin — Full access…").
    assert.ok(MYANMAR.test(tpl) || /^(\$\d|[\s—·])+$/.test(tpl), `${re} has no Myanmar text`);
  }
});

test('sentences with numbers and names are translated around the data', () => {
  const cases = {
    '3 items · 5 min ago': '3 ပစ္စည်း · 5 မိနစ်အကြာက',
    'Pay $20.87': 'ငွေပေးချေရန် $20.87',
    'Delete Espresso?': 'Espresso ကို ဖျက်မလား?',
    'Void order #12?': 'အော်ဒါ #12 ကို ပယ်ဖျက်ရန်?',
    '🍳 Send (3)': '🍳 မီးဖိုချောင်သို့ ပို့ရန် (3)',
    'Order #4 was paid on another device': 'အော်ဒါ #4 သည် အခြားစက်တွင် ပေးချေပြီး ဖြစ်နေပါသည်',
    '✓ 2 sent': '✓ 2 ခု ပို့ပြီး',
    'Tax 7%': 'အခွန် 7%',
  };
  for (const [en, my] of Object.entries(cases)) assert.equal(I18N.tr(en), my, en);
  assert.equal(I18N.tr('  Tables  '), '  စားပွဲများ  ', 'spaces around the text are kept');
});

test('anything unknown stays as it is, and what people typed is never invented into something else', () => {
  for (const typed of ['Espresso', 'Pancake Stack', 'Table 12', 'Lemonade', 'မုန့်ဟင်းခါး', '12', '$4.50', 'a@b.com']) assert.equal(I18N.tr(typed), null, typed);
  assert.equal(I18N.tr(''), null);
  assert.equal(I18N.tr('http://192.168.1.10:3000'), null);
});

test('a full stop at the end of an English sentence becomes the Myanmar one', () => {
  const t = I18N.tr('Refund order #5.');
  assert.ok(t.endsWith('။'), t);
});
