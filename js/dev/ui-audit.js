'use strict';

// Developer tool, not used by the app. Finds layout problems that tests in jsdom cannot see (it needs a real browser):
// boxes that spill out of their card, content clipped by its own box, a page that scrolls sideways, and menu-bar buttons
// that do not fit. Load it in the browser console of a signed-in session:
//
//   document.head.append(Object.assign(document.createElement('script'), { src: '/js/dev/ui-audit.js' }));
//   await UIAudit.run('my');          // visits every screen and dialog in Myanmar, prints the problems
//
// (The page's security policy only allows scripts from the server itself, so it is loaded as a file, not pasted and evaluated.)
//
// Try it at several window sizes (for example 1280×720 at 150% scaling, 1024×768, 390×844) and in both languages.
window.UIAudit = (() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const path = el => {
    const parts = [];
    for (let e = el, i = 0; e && e !== document.body && i < 3; e = e.parentElement, i++) {
      parts.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
    }
    return parts.join(' > ');
  };
  const visible = el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };

  function audit() {
    const issues = [];
    const seen = new Set();
    const add = (type, el, extra = {}) => {
      const key = type + '|' + path(el);
      if (seen.has(key)) return;
      seen.add(key);
      issues.push({ type, at: path(el), ...extra, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) });
    };
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push({ type: 'page scrolls sideways', sw: document.documentElement.scrollWidth, vw: innerWidth });
    const roots = ['#topbar', '#main', '#modal-root'].map(s => document.querySelector(s)).filter(Boolean);
    for (const root of roots) {
      for (const el of root.querySelectorAll('*')) {
        if (!visible(el)) continue;
        const cs = getComputedStyle(el);
        const clips = ['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX);
        if (el.scrollWidth > el.clientWidth + 2 && clips && cs.textOverflow !== 'ellipsis' && !el.matches('.table-wrap, .chips, .seg, .keypad')) {
          add('content clipped sideways', el, { content: el.scrollWidth, box: el.clientWidth });
        }
        if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 2) add('text cut with "…"', el, { content: el.scrollWidth, box: el.clientWidth });
        const parent = el.parentElement;
        if (!parent || parent === document.body || !visible(parent) || cs.position === 'absolute' || cs.position === 'fixed') continue;
        const pcs = getComputedStyle(parent);
        const card = (pcs.borderTopWidth !== '0px' || pcs.backgroundColor !== 'rgba(0, 0, 0, 0)' || pcs.boxShadow !== 'none') && pcs.overflowX === 'visible' && pcs.overflowY === 'visible';
        if (!card) continue;
        const r = el.getBoundingClientRect(), pr = parent.getBoundingClientRect();
        if (r.bottom > pr.bottom + 1.5) add('spills below its card', el, { by: Math.round(r.bottom - pr.bottom) });
        if (r.right > pr.right + 1.5) add('spills past the right edge of its card', el, { by: Math.round(r.right - pr.right) });
      }
    }
    const nav = document.querySelector('#topbar nav');
    if (nav && nav.scrollWidth > nav.clientWidth + 2) issues.push({ type: 'menu bar has hidden buttons', content: nav.scrollWidth, box: nav.clientWidth });
    return issues;
  }

  // Opens each screen and dialog in turn and collects the problems, each listed once with the places it was seen.
  async function run(lang = 'en') {
    I18N.set(lang);
    await sleep(60);
    const found = new Map();
    const click = sel => { const e = document.querySelector(sel); if (e) e.click(); return !!e; };
    const closeModal = () => { if (Modal.isOpen) Modal.close(true); };
    const check = async label => {
      await sleep(80);
      for (const i of audit()) {
        const key = `${i.type}|${i.at || ''}|${i.text || ''}`;
        if (!found.has(key)) found.set(key, { ...i, seenOn: [] });
        found.get(key).seenOn.push(label);
      }
    };
    const go = async nav => { closeModal(); App.go(nav); await sleep(120); };
    const product = n => Store.data.products.find(x => x.name === n);

    await go('tables'); await check('tables');
    click('[data-act=takeaway]'); await sleep(200);
    for (const n of ['Espresso', 'Latte', 'Avocado Toast', 'Chocolate Brownie', 'Fresh Orange Juice']) if (product(n)) Screens.order.add(product(n).id);
    await sleep(150); closeModal();
    await check('order screen');
    click('[data-act=more]'); await check('order: more'); closeModal();
    click('[data-act=edit-line]'); await check('order: line note'); closeModal();
    click('[data-act=pay]'); await check('checkout');
    click('.modal [data-act=method][data-method=split]'); await check('checkout: split'); closeModal();
    await go('orders'); await check('orders');
    await go('drawer'); await check('cash drawer');
    await go('products'); await check('menu & stock');
    click('[data-act=edit]'); await check('item editor');
    click('.modal [data-act=o-add]'); click('.modal [data-act=u-add]'); click('.modal [data-act=rc-add]'); await check('item editor with rows'); closeModal();
    await go('inventory');
    for (const tab of ['ingredients', 'purchases', 'suppliers', 'stocktakes']) {
      click(`[data-act=tab][data-tab=${tab}]`); await check('inventory/' + tab);
      click(`[data-act=${{ ingredients: 'new-ingredient', purchases: 'new-purchase', suppliers: 'new-supplier', stocktakes: 'new-stocktake' }[tab]}]`);
      await check('inventory/' + tab + ' dialog'); closeModal();
    }
    click('[data-act=tab][data-tab=suppliers]');
    click('[data-act=pay-supplier]:not([disabled])'); await check('pay supplier'); closeModal();
    click('[data-act=supplier-statement]'); await check('supplier statement'); closeModal();
    await go('customers'); await check('customers'); click('[data-act=edit]'); await check('customer dialog'); closeModal();
    await go('dashboard'); await check('dashboard');
    click('[data-act=tab][data-tab=tables]'); await check('dashboard: tables'); click('[data-act=tab][data-tab=orders]');
    await go('orders'); click('tr.clickable'); await check('order details'); closeModal();

    // Finance: a few records first so the tables have rows (added once).
    try {
      if (!Store.data.expenses.length) {
        Store.addExpense({ category: 'Rent', amount: 120, method: 'cash', description: 'Shop rent for the month' });
        Store.addOwnerMove({ type: 'in', amount: 50, method: 'cash', note: 'float' });
        Store.saveRecurring({ category: 'Salaries', amount: 900, method: 'other', day: 1 });
      }
    } catch (e) { /* a closed day */ }
    await sleep(400);
    await go('finance'); await sleep(600);
    for (const tab of ['pl', 'cash', 'position', 'tax', 'expenses', 'close', 'controls']) {
      click(`[data-act=tab][data-tab=${tab}]`); await sleep(200); await check('finance/' + tab);
    }
    click('[data-act=tab][data-tab=expenses]');
    for (const act of ['new-expense', 'new-recurring', 'new-owner']) { click(`[data-act=${act}]`); await check('finance dialog ' + act); closeModal(); }
    click('[data-act=tab][data-tab=close]'); click('[data-act=close-day]'); await check('finance: close the day'); closeModal();

    await go('reports'); await check('reports'); click('[data-act=range][data-range=custom]'); await check('reports: custom range');
    await go('users'); await check('staff'); click('[data-act=edit]'); await check('staff dialog'); closeModal();
    await go('settings'); await check('settings');
    for (const sel of ['[data-act=qr]', '[data-act=backup-folders]', '[data-act=audit]']) { click(sel); await check('settings ' + sel); closeModal(); }
    await go('kitchen'); await check('kitchen');
    const list = [...found.values()].map(i => ({ ...i, seenOn: i.seenOn.length > 4 ? `${i.seenOn.slice(0, 4).join(', ')} … (${i.seenOn.length} places)` : i.seenOn.join(', ') }));
    console.table(list);
    return list;
  }

  return { audit, run };
})();
