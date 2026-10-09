'use strict';

// Receivables: what customers owe for bills put on account - a statement per customer, and how old each debt is.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf, paymentByMethod } = inNode ? require('../shared.js') : root;
  const { num, live } = inNode ? require('./core.js') : root.Finance;

  const DAY = 86400000;
  // How old a debt is, in days, for the "aging" columns.
  const BUCKETS = [{ id: 'current', from: 0, to: 30 }, { id: 'd31', from: 31, to: 60 }, { id: 'd61', from: 61, to: 90 }, { id: 'd90', from: 91, to: Infinity }];

  // The entries on one customer's account, oldest first, each with the balance after it.
  // kind: 'bill' (put on account, adds to the debt), 'refund' (a bill that was refunded, takes it off), 'payment', 'writeoff'.
  // `since` is how far back this device holds every record (a moment; 0 in single-device mode). A customer who started after it
  // has a complete account, so the balance is simply what the entries add up to. For an older customer the entries this device
  // does not hold are summed into one "earlier" line, using the balance the server keeps, so the balance is always right.
  function statement(customerId, data, settings, since = null) {
    const dec = decimalsOf(settings);
    const entries = [];
    for (const o of data.orders || []) {
      if (o.customerId !== customerId || !o.payment) continue;
      const credit = num(paymentByMethod(o.payment).credit);
      if (!credit || (o.status !== 'paid' && o.status !== 'refunded')) continue;
      entries.push({ date: o.paidAt, kind: 'bill', ref: `#${o.number}`, orderId: o.id, amount: credit });
      if (o.status === 'refunded') entries.push({ date: o.refundedAt || o.paidAt, kind: 'refund', ref: `#${o.number}`, orderId: o.id, amount: -credit });
    }
    for (const p of live(data.customerPayments)) {
      if (p.customerId !== customerId) continue;
      entries.push({ date: p.date, kind: p.method === 'writeoff' ? 'writeoff' : 'payment', method: p.method, ref: p.note || '', paymentId: p.id, amount: -num(p.amount) });
    }
    entries.sort((x, y) => x.date - y.date);

    const customer = (data.customers || []).find(c => c.id === customerId);
    const explained = entries.reduce((n, e) => n + e.amount, 0);
    const complete = since !== null && !!customer && num(customer.createdAt) >= since;
    const owing = customer && !complete ? num(customer.owing) : explained;
    const earlier = roundTo(owing - explained, dec);
    if (Math.abs(earlier) >= 0.005) entries.unshift({ date: entries.length ? entries[0].date - 1 : 0, kind: 'earlier', ref: '', amount: earlier });

    let balance = 0;
    for (const e of entries) { balance += e.amount; e.balance = roundTo(balance, dec); }
    return { customerId, name: customer ? customer.name : '', owing: roundTo(owing, dec), entries };
  }

  // Every customer who owes (or is owed) something: the balance, how it splits by age, and the oldest unpaid bill.
  // Payments are matched to the oldest bills first, so what is left is the newest debt.
  function receivables(data, settings, now = Date.now(), since = null) {
    const dec = decimalsOf(settings);
    const rows = [];
    for (const c of data.customers || []) {
      if (!num(c.owing) && !(data.orders || []).some(o => o.customerId === c.id && o.payment && paymentByMethod(o.payment).credit)) continue;
      const st = statement(c.id, data, settings, since);
      if (!st.owing) continue;
      // First in, first paid: walk the entries and let each payment cancel the oldest open bills.
      const open = [];
      for (const e of st.entries) {
        if (e.amount > 0) { open.push({ date: e.date, left: e.amount, orderId: e.orderId }); continue; }
        let pay = -e.amount;
        // A refunded bill cancels that bill itself, not the oldest one.
        const own = e.kind === 'refund' ? open.find(o => o.orderId === e.orderId) : null;
        if (own) {
          const take = Math.min(pay, own.left);
          own.left -= take; pay -= take;
          if (own.left <= 1e-9) open.splice(open.indexOf(own), 1);
        }
        while (pay > 1e-9 && open.length) {
          const take = Math.min(pay, open[0].left);
          open[0].left -= take; pay -= take;
          if (open[0].left <= 1e-9) open.shift();
        }
      }
      const buckets = Object.fromEntries(BUCKETS.map(b => [b.id, 0]));
      for (const o of open) {
        const age = Math.max(0, Math.floor((now - o.date) / DAY));
        buckets[BUCKETS.find(b => age >= b.from && age <= b.to).id] += o.left;
      }
      for (const k of Object.keys(buckets)) buckets[k] = roundTo(buckets[k], dec);
      rows.push({
        customerId: c.id, name: c.name, owing: st.owing, limit: num(c.creditLimit), buckets,
        oldest: open.length ? open[0].date : null,
      });
    }
    rows.sort((x, y) => y.owing - x.owing);
    const total = key => roundTo(rows.reduce((n, r) => n + (key === 'owing' ? Math.max(0, r.owing) : r.buckets[key]), 0), dec);
    return { rows, totals: { owing: total('owing'), ...Object.fromEntries(BUCKETS.map(b => [b.id, total(b.id)])) }, buckets: BUCKETS };
  }

  const api = { statement, receivables };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
