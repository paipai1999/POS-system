'use strict';

// Finance → Business health, Sales patterns and Menu engineering, in the real app. Needs jsdom:  npm install
// Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, startServer, openApp } = require('./harness.js');

const opts = JSDOM ? {} : { skip: 'jsdom is not installed (run "npm install" once)' };

let srv;
const tabs = [];
const open = async o => { const t = await openApp(srv.base, o); tabs.push(t); return t; };
function seed() {
  // Today: lunch at table 1 (two bills), dinner at table 2, a takeaway. Latte is cheap to make (a star); Avocado Toast has no recipe.
  bill({ lines: [['Latte', 10, 0.8], ['Avocado Toast', 3]], at: todayAt(12 * 60 + 30), minutes: 50, tableName: 'Table 1' });
  bill({ lines: [['Latte', 8, 0.8], ['Espresso', 4, 0.5]], at: todayAt(13 * 60 + 10), minutes: 30, tableName: 'Table 1', by: 'Maya' });
  bill({ lines: [['Latte', 6, 0.8], ['Iced Americano', 2, 0.6]], at: todayAt(19 * 60), minutes: 70, tableName: 'Table 2' });
  bill({ lines: [['Espresso', 2, 0.5]], at: todayAt(19 * 60 + 20), minutes: 5 });
  expense('e_own1', 'Rent', 40);
  expense('e_own2', 'Salaries', 60);
}
test.before(async () => { if (JSDOM) { srv = await startServer(); seed(); } });
test.after(async () => {
  tabs.forEach(t => { try { t.close(); } catch (e) { /* already closed */ } });
  if (srv) await srv.stop();
});

const db = () => srv.app.db;
const startOfToday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const todayAt = minute => startOfToday + minute * 60000;      // minutes after midnight, so a test is the same at any time of day
const user = name => db().all('users').find(u => u.name === name);
const product = name => db().all('products').find(p => p.name === name);
const table = name => db().all('tables').find(t => t.name === name);

// A finished bill written straight into the database. `cost` per dish is the ingredient cost it had when sold.
let seq = 0;
function bill({ lines, at, minutes = 40, tableName = null, by = 'Leo' }) {
  const n = ++seq;
  const items = lines.map(([name, qty, cost]) => { const p = product(name); return { id: `l${n}${name}`, productId: p.id, name, price: p.price, qty, sentQty: qty, ...(cost === undefined ? {} : { cost }) }; });
  const subtotal = Math.round(items.reduce((s, l) => s + l.price * l.qty, 0) * 100) / 100;
  const t = tableName ? table(tableName) : null;
  const o = {
    id: 'o_own' + n, number: 9000 + n, tableId: t ? t.id : null, tableName: t ? t.name : '', staffId: user(by).id, cashierId: user('Maya').id, status: 'paid', note: '',
    createdAt: at - minutes * 60000, paidAt: at, items, discount: null,
    totals: { subtotal, discount: 0, points: 0, service: 0, serviceRate: 0, tax: 0, taxRate: 0, total: subtotal },
    payment: { method: 'cash', amount: subtotal, tip: 0, tendered: subtotal },
  };
  db().put('orders', o.id, o);
  return o;
}
const expense = (id, category, amount) => db().put('expenses', id, { id, date: todayAt(60), category, amount, method: 'cash', status: 'active', note: '' });

async function openTab(t, tab) {
  if (t.screen() !== 'finance') {
    t.click('[data-nav=finance]');
    await t.until(() => t.screen() === 'finance');
  }
  await t.until(() => t.$('.tabs'), { what: 'the finance tabs' });
  t.click(`[data-act=tab][data-tab=${tab}]`);
  await t.until(() => t.$(`.tabs .active[data-tab=${tab}]`), { what: `the ${tab} tab` });
  t.click('[data-act=range][data-range=today]');
  await t.sleep(60);
}
const statement = t => t.text('[data-role=statement]');

test('Sales patterns: the figures, the busy-hour notes, the grid, the tables and the servers', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '1234', '482915');
  await openTab(admin, 'patterns');
  const text = statement(admin);
  assert.match(text, /Busiest hour 1[23]:00–1[34]:00/);
  assert.match(text, /Guests stay about \d+ min/);
  assert.match(text, /Takeaway share of sales [\d.]+%/);
  assert.equal(admin.$$('[data-role=statement] .stat').length, 4);
  assert.ok(admin.$('.heat'), 'the day-and-hour grid');
  assert.ok(admin.$$('.heat td[style]').length >= 3, 'cells are shaded where bills were paid');
  assert.ok(admin.$$('[data-role=statement] .bar-row').length === 7, 'one bar for each day of the week');
  const cells = admin.$$('[data-role=statement] table.data tbody tr').map(r => [...r.cells].map(c => c.textContent.replace(/\s+/g, ' ').trim()));
  const rowOf = name => cells.find(c => c[0] === name);
  assert.equal(rowOf('Table 1')[1], '2', 'Table 1 had two bills');
  assert.equal(rowOf('Table 2')[1], '1');
  assert.equal(rowOf('Leo')[1], '3', 'Leo took three bills');
  assert.equal(rowOf('Maya')[1], '1');
  assert.match(rowOf('Table 1')[4], /^\d+ min$/, 'how long guests stayed');
});

test('Sales patterns: CSV and print work, and an empty period says so', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.w.eval('window.__files = []; downloadFile = (name, content, type) => window.__files.push({ name, content, type })');
  await openTab(admin, 'patterns');
  admin.click('[data-act=export-csv]');
  const [file] = admin.get('window.__files');
  assert.match(file.name, /^sales-patterns_\d{4}-\d\d-\d\d_to_\d{4}-\d\d-\d\d\.csv$/);
  assert.match(file.content, /^Day,Days in period,Bills,Sales/);
  assert.match(file.content, /Table 1,2,/);
  admin.click('[data-act=print]');
  assert.equal(admin.prints.length, 1);
  assert.match(admin.prints[0], /Sales patterns/);
  assert.ok(!/<button/.test(admin.prints[0]));

  admin.click('[data-act=range][data-range=yesterday]');
  await admin.sleep(80);
  assert.match(statement(admin), /No sales in this period/);
});

test('Menu engineering: dishes are grouped and listed with their margins', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  await openTab(admin, 'menu');
  const text = statement(admin);
  assert.match(text, /Stars \d/);
  assert.match(text, /Puzzles \d/);
  assert.match(text, /Plowhorses \d/);
  assert.match(text, /Dogs \d/);
  const rows = admin.$$('[data-role=statement] table.data tbody tr').map(r => [...r.cells].map(c => c.textContent.replace(/\s+/g, ' ').trim()));
  const dish = name => rows.find(r => r[0] === name);
  assert.equal(dish('Latte')[2], '24', '10 + 8 + 6 sold');
  assert.equal(dish('Latte')[8], 'Star');
  assert.equal(dish('Latte')[5], '$3.20', 'sells at 4.00 and costs 0.80 to make');
  assert.equal(dish('Avocado Toast')[8], 'No recipe', 'a dish with no cost is not guessed at');
  assert.equal(dish('Avocado Toast')[5], '—');
  assert.match(text, /Dishes with no recipe\s*1/);
  assert.match(text, /Average margin per portion/);
});

test('Business health: ratios, verdicts and the break-even point', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  await openTab(admin, 'kpis');
  const cards = admin.$$('[data-role=statement] .kpi').map(c => c.textContent.replace(/\s+/g, ' ').trim());
  assert.equal(cards.length, 5, 'food, labour, prime cost, rent and net margin');
  assert.ok(cards.some(c => /^Food cost/.test(c)));
  assert.ok(cards.some(c => /^Labour/.test(c) && /Good|Watch|Too high/.test(c)));
  assert.ok(cards.some(c => /^Net margin/.test(c)));
  const text = statement(admin);
  assert.match(text, /Break-even/);
  assert.match(text, /Sales needed per day to break even\s*\$[\d.,]+/);
  assert.match(text, /Your sales per day\s*\$[\d.,]+/);
  assert.match(text, /Sales can fall by\s*[\d.]+%\s*before this period loses money/);
  assert.ok(!admin.$('[data-role=statement] .alert-box'), 'nearly every sale here has a recipe, so there is nothing to warn about');
});

test('Myanmar: the three new tabs are translated', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.w.eval("I18N.set('my')");
  const latin = sel => admin.$$(sel)
    .map(e => e.textContent.replace(/\s+/g, ' ').replace(/[A-Z][a-z]{2} \d{1,2}, \d{4}(, \d{1,2}:\d\d [AP]M)?/g, '').trim())
    .filter(x => /[A-Za-z]/.test(x))
    .filter(x => !x.split(' · ').every(part => /^(Admin|Maya|Leo|Table \d|Latte|Espresso|Avocado Toast|Iced Americano|Coffee|Breakfast|Other)$/.test(part)));   // names people typed stay as typed
  for (const tab of ['kpis', 'patterns', 'menu']) {
    await openTab(admin, tab);
    await admin.sleep(80);
    assert.deepEqual(latin('.page-head h1, .tabs button, [data-role=statement] th, [data-role=statement] h2, [data-role=statement] h3, [data-role=statement] .label, [data-role=statement] .notes, [data-role=statement] .alert-box, [data-role=statement] .insights li, [data-role=statement] .stat .muted, [data-role=statement] .stat .pill, [data-role=statement] p, [data-role=statement] .pill, [data-role=statement] .kpi-hint, [data-role=statement] td.empty'), [], tab);
  }
});
