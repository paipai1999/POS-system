'use strict';

// Monthly expenses that repeat (rent, salaries): which records are due.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { num, pad, channel, dayKey, monthKey } = inNode ? require('./core.js') : root.Finance;

  // ----- monthly expenses that repeat (rent, salaries) -----
  // A template is { id, category, description, amount, taxAmount, method, day (1-28), startMonth 'YYYY-MM', active }.
  // Returns the expense records that should exist by `now` but do not yet, one per template per month. The id is fixed, so
  // creating them twice (two devices, a restart) can never double-count, and a voided one is not brought back.
  // A due day that has already been closed is booked today instead.
  function dueRecurring(templates, expenses, now = Date.now(), isClosed = () => false) {
    const have = new Set((expenses || []).map(e => e.id));
    const nowDate = new Date(now);
    const out = [];
    for (const t of templates || []) {
      if (!t || !t.id || t.active === false) continue;
      let [y, m] = String(t.startMonth || monthKey(now)).split('-').map(Number);
      if (!y || !m) continue;
      const day = Math.min(28, Math.max(1, Math.floor(num(t.day)) || 1));
      for (let n = 0; n < 36 && (y < nowDate.getFullYear() || (y === nowDate.getFullYear() && m <= nowDate.getMonth() + 1)); n++) {
        const due = new Date(y, m - 1, day).getTime();
        const id = `rx_${t.id}_${y}${pad(m)}`;
        if (due <= now && !have.has(id)) {
          out.push({
            id, date: isClosed(dayKey(due)) ? now : due, category: t.category, description: t.description || '', amount: num(t.amount), taxAmount: num(t.taxAmount),
            method: channel(t.method) === 'cash' ? 'other' : channel(t.method), payee: t.payee || '', note: '', status: 'active', by: 'system', createdAt: now, recurringId: t.id,
          });
        }
        if (++m > 12) { m = 1; y++; }
      }
    }
    return out;
  }

  const api = { dueRecurring };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
