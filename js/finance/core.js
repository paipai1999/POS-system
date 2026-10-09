'use strict';

// Shared pieces of the financial statements: which records count in a period, dates, channels and the finance setup.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const DEFAULT_CATEGORIES = ['Rent', 'Salaries', 'Utilities', 'Gas & fuel', 'Repairs & maintenance', 'Cleaning & supplies', 'Marketing', 'Transport & delivery', 'Licences & fees', 'Equipment', 'Tips paid to staff', 'Other'];

  // Paying tips out to staff moves money but is neither income nor an expense of the restaurant.
  const TIPS_CATEGORY = 'Tips paid to staff';

  const CHANNELS = ['cash', 'card', 'other'];

  const num = v => Number(v) || 0;

  const pad = n => String(n).padStart(2, '0');

  const channel = m => (m === 'cash' || m === 'card' ? m : 'other');

  const zero = () => ({ cash: 0, card: 0, other: 0 });

  const inRange = (t, a, b) => num(t) >= a && num(t) < b;

  const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);

  const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  const monthKey = ts => dayKey(ts).slice(0, 7);

  const dayBounds = key => { const [y, m, d] = key.split('-').map(Number); return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()]; };

  // ----- which records count in a period -----
  const isSale = o => (o.status === 'paid' || o.status === 'refunded') && !!o.totals;

  const refundTime = o => o.refundedAt || o.paidAt;

  const sold = (orders, a, b) => orders.filter(o => isSale(o) && inRange(o.paidAt, a, b));

  const refunded = (orders, a, b) => orders.filter(o => o.status === 'refunded' && !!o.totals && inRange(refundTime(o), a, b));

  const live = list => (list || []).filter(x => x && x.status !== 'void');

  const netOf = o => num(o.totals.subtotal) - num(o.totals.discount) - num(o.totals.points);

  const costOf = o => sum(o.items || [], l => (l.cost !== undefined && l.cost !== null ? num(l.cost) * num(l.qty) : 0));

  const purchaseNet = p => num(p.total) - num(p.taxAmount);

  // Settings → finance setup: opening balances (as of a start date) and the list of expense categories.
  function financeOf(settings) {
    const f = (settings && settings.finance) || {};
    const cats = (Array.isArray(f.categories) ? f.categories : []).filter(c => typeof c === 'string' && c.trim()).map(c => c.trim());
    return {
      openingCash: num(f.openingCash), openingBank: num(f.openingBank), startDate: num(f.startDate),
      categories: cats.length ? cats : DEFAULT_CATEGORIES.slice(),
    };
  }

  // The period before `range`, of the same length (for "compared with").
  function previousRange(range) {
    const [a, b] = range;
    const days = Math.round((b - a) / 86400000);
    const start = new Date(a);
    start.setDate(start.getDate() - days);
    return [start.getTime(), a];
  }

  const api = { DEFAULT_CATEGORIES, TIPS_CATEGORY, CHANNELS, num, pad, channel, zero, inRange, sum, dayKey, monthKey, dayBounds, isSale, refundTime, sold, refunded, live, netOf, costOf, purchaseNet, financeOf, previousRange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
