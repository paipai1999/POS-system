'use strict';

Screens.reports = {
  perm: 'reports',
  live: ['orders', 'products'],
  state: { range: 'today', from: isoDate(new Date()), to: isoDate(new Date()) },

  bounds() {
    const st = this.state;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    switch (st.range) {
      case 'yesterday': return [addDays(today, -1), today];
      case 'week': return [addDays(today, -6), addDays(today, 1)];
      case 'month': return [new Date(today.getFullYear(), today.getMonth(), 1), addDays(today, 1)];
      case 'custom': {
        const from = st.from ? parse(st.from) : today;
        const to = st.to ? parse(st.to) : today;
        return from <= to ? [from, addDays(to, 1)] : [to, addDays(from, 1)];
      }
      default: return [today, addDays(today, 1)];
    }
  },

  // Bills sold in the period (paid on one of its days), including ones that were refunded later.
  ordersInRange() {
    const [start, end] = this.bounds().map(d => d.getTime());
    return Store.data.orders.filter(o => (o.status === 'paid' || o.status === 'refunded') && o.paidAt >= start && o.paidAt < end);
  },

  // Bills refunded in the period, whenever they were sold: a refund is taken off on the day it is made, so a month that is
  // already over never changes.
  refundsInRange() {
    const [start, end] = this.bounds().map(d => d.getTime());
    return Store.data.orders.filter(o => o.status === 'refunded' && (o.refundedAt || o.paidAt) >= start && (o.refundedAt || o.paidAt) < end);
  },

  render(root) {
    const st = this.state;
    // In server mode only the last two days are on this device; older periods are fetched first.
    const from = this.bounds()[0].getTime();
    if (!Sync.ordersLoaded(from)) {
      root.innerHTML = '<div class="page-head"><h1>Reports</h1></div><p class="empty">Loading sales…</p>';
      Sync.loadOrders(from)
        .then(() => { if (App.screen === 'reports') this.render(root); })
        .catch(e => { root.innerHTML = `<p class="empty">${esc(e.message)}</p>`; });
      return;
    }
    const paid = this.ordersInRange();            // sold in the period (some may have been refunded later)
    const refunded = this.refundsInRange();       // refunded in the period (some may have been sold earlier)
    const all = [...new Set([...paid, ...refunded])];
    const sum = (arr, f) => rmoney(arr.reduce((s, x) => s + f(x), 0));
    const gross = sum(paid, o => o.totals.total);
    const net = sum(paid, o => o.totals.subtotal - o.totals.discount);
    const discounts = sum(paid, o => o.totals.discount);
    const tax = sum(paid, o => o.totals.tax);
    const service = sum(paid, o => o.totals.service);
    const tips = sum(paid, o => (o.payment && o.payment.tip) || 0);
    // Ingredient cost is known only for items that have a recipe (each paid line carries the cost it had at the time).
    let cogs = 0, costedSales = 0, allSales = 0;
    for (const o of paid) for (const l of o.items) {
      allSales += l.price * l.qty;
      if (l.cost !== undefined) { cogs += l.cost * l.qty; costedSales += l.price * l.qty; }
    }
    const [rangeStart, rangeEnd] = this.bounds().map(d => d.getTime());
    const bought = sum(Store.data.purchases.filter(p => p.status === 'received' && p.date >= rangeStart && p.date < rangeEnd), p => p.total);
    const lowIng = Store.lowIngredients();
    const refundTotal = sum(refunded, o => o.totals.total);
    const refundedCost = refunded.reduce((n, o) => n + o.items.reduce((m, l) => m + (l.cost !== undefined ? l.cost * l.qty : 0), 0), 0);
    cogs -= refundedCost;

    const items = {}, cats = {}, methods = {}, staff = {};
    const hours = Array(24).fill(0);
    for (const o of paid) {
      for (const [k, amount] of Object.entries(paymentByMethod(o.payment))) { // a split bill counts under each method used
        const m = (methods[k] ||= { count: 0, amount: 0 });
        m.count++; m.amount += amount;
      }
      const s = (staff[o.staffId] ||= { count: 0, amount: 0 });
      s.count++; s.amount += o.totals.total;
      hours[new Date(o.paidAt).getHours()] += o.totals.total;
      for (const l of o.items) {
        const it = (items[l.productId] ||= { name: l.name, qty: 0, amount: 0 });
        it.qty += l.qty; it.amount += l.qty * l.price;
        const p = Store.product(l.productId);
        const cat = p && Store.category(p.categoryId);
        const c = (cats[cat ? cat.name : 'Other'] ||= { qty: 0, amount: 0 });
        c.qty += l.qty; c.amount += l.qty * l.price;
      }
    }
    const topItems = Object.values(items).sort((a, b) => b.qty - a.qty || b.amount - a.amount).slice(0, 10);
    const activeHours = hours.map((v, h) => ({ h, v })).filter(x => x.v > 0);
    const hourRows = activeHours.length
      ? hours.slice(activeHours[0].h, activeHours[activeHours.length - 1].h + 1)
        .map((v, i) => ({ label: `${pad2(activeHours[0].h + i)}:00`, value: v, text: money(v) }))
      : [];
    const low = Store.data.products.filter(p => p.trackStock && p.active && p.stock <= p.lowStock);

    const stat = (label, value, sub = '') => `<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;

    root.innerHTML = `
      <div class="page-head">
        <h1>Reports</h1>
        <div class="actions"><button class="btn" data-act="csv" ${all.length ? '' : 'disabled'}>⬇️ Export CSV</button></div>
      </div>
      <div class="toolbar">
        <div class="seg">
          ${[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', '7 days'], ['month', 'This month'], ['custom', 'Custom']].map(([k, label]) =>
            `<button data-act="range" data-range="${k}" class="${st.range === k ? 'active' : ''}">${label}</button>`).join('')}
        </div>
        ${st.range === 'custom' ? `
          <input class="input" type="date" data-role="from" value="${st.from}" aria-label="From">
          <span class="muted">to</span>
          <input class="input" type="date" data-role="to" value="${st.to}" aria-label="To">` : ''}
      </div>
      <div class="stats">
        ${stat('Total sales', money(gross), 'incl. tax &amp; service')}
        ${stat('Net sales', money(net), 'after discounts, before tax')}
        ${stat('Orders', paid.length)}
        ${stat('Average order', money(paid.length ? gross / paid.length : 0))}
        ${stat('Tax collected', money(tax))}
        ${service ? stat('Service charge', money(service)) : ''}
        ${tips ? stat('Tips', money(tips), 'not part of sales') : ''}
        ${cogs ? stat('Ingredient cost', money(cogs), `${Math.round(costedSales / (allSales || 1) * 100)}% of sales have a recipe`) : ''}
        ${cogs ? stat('Profit on those items', money(costedSales - cogs), `${costedSales ? Math.round((costedSales - cogs) / costedSales * 100) : 0}% margin`) : ''}
        ${bought ? stat('Bought (purchases)', money(bought), 'ingredients received') : ''}
        ${stat('Discounts', money(discounts))}
        ${stat('Refunds', money(refundTotal), `${refunded.length} order${refunded.length === 1 ? '' : 's'}`)}
        ${refunded.length ? stat('Sales after refunds', money(gross - refundTotal), 'total sales − refunds') : ''}
      </div>
      <div class="report-grid">
        <section class="card">
          <h2>Best sellers</h2>
          ${topItems.length ? `
            <table class="data compact">
              <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Sales</th></tr></thead>
              <tbody>${topItems.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${i.qty}</td><td class="num">${money(i.amount)}</td></tr>`).join('')}</tbody>
            </table>` : '<p class="empty small">No sales in this period</p>'}
        </section>
        <section class="card">
          <h2>Sales by category</h2>
          ${barList(Object.entries(cats).sort((a, b) => b[1].amount - a[1].amount).map(([name, c]) => ({ label: name, value: c.amount, text: money(c.amount) })))}
        </section>
        <section class="card">
          <h2>Payment methods</h2>
          ${barList(Object.entries(methods).map(([k, m]) => ({ label: PAY_METHODS[k] || k, value: m.amount, text: `${money(m.amount)} · ${m.count}` })))}
        </section>
        <section class="card">
          <h2>Sales by server</h2>
          ${barList(Object.entries(staff).sort((a, b) => b[1].amount - a[1].amount).map(([id, s]) => {
            const u = Store.user(id);
            return { label: u ? u.name : 'Unknown', value: s.amount, text: `${money(s.amount)} · ${s.count}` };
          }))}
        </section>
        <section class="card">
          <h2>Sales by hour</h2>
          ${barList(hourRows)}
        </section>
        <section class="card">
          <h2>Low stock</h2>
          ${low.length || lowIng.length
            ? `<table class="data compact"><tbody>${low.map(p => `<tr><td>${esc(p.emoji)} ${esc(p.name)}</td><td class="num low-stock">${p.stock} left</td></tr>`).join('')}${lowIng.map(i => `<tr><td>🧂 ${esc(i.name)}</td><td class="num low-stock">${qtyText(i.stock)} ${esc(i.unit)} left</td></tr>`).join('')}</tbody></table>`
            : '<p class="empty small">All tracked items are well stocked 👍</p>'}
        </section>
      </div>`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      if (t.dataset.act === 'range') { st.range = t.dataset.range; this.render(root); }
      else if (t.dataset.act === 'csv') this.exportCSV(all);
    };
    root.onchange = e => {
      const role = e.target.dataset.role;
      if (role === 'from' || role === 'to') { st[role] = e.target.value; this.render(root); }
    };
  },

  exportCSV(orders) {
    const [start, end] = this.bounds();
    end.setDate(end.getDate() - 1);
    downloadFile(`sales_${isoDate(start)}_to_${isoDate(end)}.csv`, this.csv(orders), 'text/csv');
  },

  // The orders as CSV text (also used by the Orders screen for its filtered list).
  csv(orders) {
    const cell = v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Order', 'Paid at', 'Status', 'Table', 'Server', 'Cashier', 'Items', 'Subtotal', 'Discount', 'Service', 'Tax', 'Total', 'Tip', 'Payment'];
    const rows = orders.map(o => {
      const t = o.totals;
      const server = Store.user(o.staffId);
      const cashier = Store.user(o.cashierId);
      return [
        o.number, new Date(o.paidAt).toLocaleString(), o.status, whereLabel(o),
        server ? server.name : '', cashier ? cashier.name : '',
        o.items.map(l => `${l.qty}x ${l.name}`).join('; '),
        t.subtotal, t.discount, t.service, t.tax, t.total, (o.payment && o.payment.tip) || 0,
        !o.payment ? '' : o.payment.method === 'split' && o.payment.parts
          ? 'split: ' + o.payment.parts.map(p => `${p.method} ${p.amount}`).join(' + ')
          : o.payment.method,
      ];
    });
    return [header, ...rows].map(r => r.map(cell).join(',')).join('\n');
  },
};
