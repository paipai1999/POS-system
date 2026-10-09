'use strict';

// Order history: filter by period, status, payment, server and table, search by number, table, dish or customer, sort,
// totals for what is shown, a detail view for any order, and a CSV of the filtered list.
Screens.orders = {
  perm: 'orders',
  live: ['orders', 'users', 'kitchenTickets'],
  state: { range: 'today', from: isoDate(new Date()), to: isoDate(new Date()), status: 'all', method: 'all', staff: 'all', where: 'all', sort: 'newest', q: '', limit: 100 },

  // The period as [start, end) in milliseconds.
  bounds() {
    const st = this.state;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    let a, b;
    switch (st.range) {
      case 'all': return [0, Infinity];
      case 'yesterday': a = addDays(today, -1); b = today; break;
      case 'week': a = addDays(today, -6); b = addDays(today, 1); break;
      case 'month': a = new Date(today.getFullYear(), today.getMonth(), 1); b = addDays(today, 1); break;
      case 'custom': {
        const f = st.from ? parse(st.from) : today, t = st.to ? parse(st.to) : today;
        [a, b] = f <= t ? [f, addDays(t, 1)] : [t, addDays(f, 1)];
        break;
      }
      default: a = today; b = addDays(today, 1);
    }
    return [a.getTime(), b.getTime()];
  },

  when: o => o.paidAt || o.createdAt,

  // The methods a bill was paid with (a split bill is "split" and also counts under each method used).
  methodsOf(o) {
    const p = o.payment;
    if (!p) return [];
    return p.method === 'split' ? ['split', ...(p.parts || []).map(x => x.method)] : [p.method];
  },

  haystack(o) {
    const staff = Store.user(o.staffId), customer = o.customerId && Store.customer(o.customerId);
    return [orderNo(o), whereLabel(o), staff && staff.name, customer && customer.name, o.note, ...o.items.map(l => l.name)].join(' ').toLowerCase();
  },

  list() {
    const st = this.state;
    const [a, b] = this.bounds();
    const q = st.q.trim().toLowerCase().replace(/^#/, '');
    const total = o => Store.totals(o).total;
    const sorts = {
      newest: (x, y) => this.when(y) - this.when(x),
      oldest: (x, y) => this.when(x) - this.when(y),
      highest: (x, y) => total(y) - total(x),
      lowest: (x, y) => total(x) - total(y),
    };
    return Store.data.orders
      .filter(o => App.user.role !== 'waiter' || o.staffId === App.user.id)
      .filter(o => { const w = this.when(o); return w >= a && w < b; })
      .filter(o => st.status === 'all' || o.status === st.status)
      .filter(o => st.method === 'all' || this.methodsOf(o).includes(st.method))
      .filter(o => st.staff === 'all' || o.staffId === st.staff)
      .filter(o => st.where === 'all' || (st.where === 'takeaway' ? !o.tableId : o.tableId === st.where))
      .filter(o => !q || this.haystack(o).includes(q))
      .sort(sorts[st.sort] || sorts.newest);
  },

  summary(list) {
    const paid = list.filter(o => o.status === 'paid');
    const refunded = list.filter(o => o.status === 'refunded');
    const sum = (arr, f) => rmoney(arr.reduce((n, o) => n + f(o), 0));
    const sales = sum(paid, o => Store.totals(o).total);
    const stat = (label, value, sub = '') => `<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
    return `
      <div class="stats compact">
        ${stat('Orders', list.length)}
        ${stat('Sales', money(sales), 'paid orders')}
        ${stat('Average order', money(paid.length ? sales / paid.length : 0))}
        ${stat('Items sold', paid.reduce((n, o) => n + o.items.reduce((m, l) => m + l.qty, 0), 0))}
        ${stat('Refunds', money(sum(refunded, o => Store.totals(o).total)), `${refunded.length} order${refunded.length === 1 ? '' : 's'}`)}
      </div>`;
  },

  rows(list) {
    if (!list.length) return '<tr><td colspan="9" class="empty">No orders found</td></tr>';
    return list.slice(0, this.state.limit).map(o => {
      const staff = Store.user(o.staffId);
      const items = o.items.reduce((n, l) => n + l.qty, 0);
      return `
        <tr class="clickable" data-act="detail" data-id="${o.id}">
          <td><b>#${orderNo(o)}</b></td>
          <td>${fmtDateTime(this.when(o))}</td>
          <td>${esc(whereLabel(o))}</td>
          <td>${esc(staff ? staff.name : '-')}</td>
          <td class="num">${items}</td>
          <td class="num">${money(Store.totals(o).total)}</td>
          <td>${o.payment ? PAY_METHODS[o.payment.method] || '' : ''}</td>
          <td><span class="pill ${o.status}">${o.status}</span></td>
          <td><div class="row-actions">
            ${o.status === 'open' && App.can('tables') ? `<button class="btn small" data-act="open" data-id="${o.id}">Open</button>` : ''}
            ${o.status === 'paid' || o.status === 'refunded' ? `<button class="btn small" data-act="receipt" data-id="${o.id}">Receipt</button>` : ''}
            ${o.status === 'paid' && App.can('checkout') ? `<button class="btn small danger" data-act="refund" data-id="${o.id}">Refund</button>` : ''}
          </div></td>
        </tr>`;
    }).join('');
  },

  // Everything under the filters; redrawn as they change (the filter controls themselves are left alone so typing is not interrupted).
  bodyHTML() {
    if (!Sync.ordersLoaded(this.bounds()[0])) return '<p class="empty">Loading older orders…</p>';
    const list = this.list();
    this.shown = list;
    const more = list.length - this.state.limit;
    return `
      ${this.summary(list)}
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>#</th><th>Time</th><th>Table</th><th>Server</th><th class="num">Items</th><th class="num">Total</th><th>Paid by</th><th>Status</th><th></th></tr></thead>
          <tbody>${this.rows(list)}</tbody>
        </table>
      </div>
      ${more > 0 ? `<div class="more-row"><span class="muted small">Showing ${this.state.limit} of ${list.length}</span> <button class="btn small" data-act="more">Show more</button></div>` : ''}`;
  },

  render(root) {
    this.root = root;
    const st = this.state;
    const from = this.bounds()[0];
    if (!Sync.ordersLoaded(from)) {
      Sync.loadOrders(from)
        .then(() => { if (App.screen === 'orders') App.refreshScreen(); })
        .catch(e => toast(e.message, 'error'));
    }
    const waiter = App.user.role === 'waiter';
    const select = (role, options) => `<select class="input" data-role="${role}" aria-label="${esc(options[0][1])}">${options.map(([v, label]) => `<option value="${esc(v)}" ${st[role] === v ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    root.innerHTML = `
      <div class="page-head">
        <h1>${waiter ? 'My orders' : 'Orders'}</h1>
        <div class="actions"><button class="btn" data-act="csv">⬇️ Export CSV</button></div>
      </div>
      <div class="toolbar">
        <div class="seg">
          ${[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', '7 days'], ['month', 'This month'], ['custom', 'Custom'], ['all', 'All']].map(([k, label]) =>
            `<button data-act="range" data-range="${k}" class="${st.range === k ? 'active' : ''}">${label}</button>`).join('')}
        </div>
        ${st.range === 'custom' ? `
          <input class="input" type="date" data-role="from" value="${st.from}" aria-label="From">
          <span class="muted">to</span>
          <input class="input" type="date" data-role="to" value="${st.to}" aria-label="To">` : ''}
      </div>
      <div class="toolbar">
        ${select('status', [['all', 'All statuses'], ...['open', 'paid', 'refunded', 'void'].map(s => [s, s[0].toUpperCase() + s.slice(1)])])}
        ${select('method', [['all', 'All payment methods'], ['cash', 'Cash'], ['card', 'Card'], ['other', 'Other'], ['credit', 'On account'], ['split', 'Split']])}
        ${waiter ? '' : select('staff', [['all', 'All staff'], ...Store.data.users.map(u => [u.id, u.name])])}
        ${select('where', [['all', 'All tables'], ['takeaway', 'Takeaway'], ...Store.data.tables.map(t => [t.id, t.name])])}
        ${select('sort', [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['highest', 'Highest total'], ['lowest', 'Lowest total']])}
        <input class="input" type="search" data-role="q" placeholder="Search #, table, dish or customer…" value="${esc(st.q)}">
      </div>
      <div data-role="body">${this.bodyHTML()}</div>`;

    const body = () => { root.querySelector('[data-role=body]').innerHTML = this.bodyHTML(); };
    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const id = t.dataset.id;
      switch (t.dataset.act) {
        case 'range': st.range = t.dataset.range; st.limit = 100; this.render(root); break;
        case 'open': App.go('order', { orderId: id }); break;
        case 'receipt': showReceipt(id); break;
        case 'refund': this.refund(root, id); break;
        case 'detail': this.detail(id); break;
        case 'more': st.limit += 200; body(); break;
        case 'csv': this.exportCSV(); break;
      }
    };
    root.oninput = e => {
      if (e.target.dataset.role !== 'q') return;
      st.q = e.target.value;
      st.limit = 100;
      body();
    };
    root.onchange = e => {
      const role = e.target.dataset.role;
      if (role === 'from' || role === 'to') { st[role] = e.target.value; st.limit = 100; this.render(root); }
      else if (['status', 'method', 'staff', 'where', 'sort'].includes(role)) { st[role] = e.target.value; st.limit = 100; body(); }
    };
  },

  // One order in full: who, when, what, how it was paid and how long the kitchen took.
  detail(id) {
    const o = Store.order(id);
    if (!o) return;
    const t = Store.totals(o);
    const user = uid => (uid && Store.user(uid) ? Store.user(uid).name : '');
    const customer = o.customerId && Store.customer(o.customerId);
    const kv = (label, value) => (value ? `<div class="kv"><span>${label}</span><b>${value}</b></div>` : '');
    const row = (label, val, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num">${val}</td></tr>`;
    const tickets = Store.data.kitchenTickets.filter(k => k.orderId === o.id && k.status !== 'void').sort((a, b) => a.createdAt - b.createdAt);
    const cost = o.items.reduce((n, l) => n + (l.cost !== undefined ? l.cost * l.qty : 0), 0);
    const hasCost = o.items.some(l => l.cost !== undefined);
    const disc = o.discount
      ? (o.discount.type === 'percent' ? `${o.discount.value}%` : money(o.discount.value)) : '';
    const discBy = o.discount && (o.discount.customerId ? 'Customer discount' : user(o.discount.by));
    const minutes = (a, b) => (a && b ? `${Math.max(0, Math.round((b - a) / 60000))} min` : '—');
    const actions = {
      open: () => App.go('order', { orderId: id }),
      receipt: () => showReceipt(id, { onClose: () => this.detail(id) }),
      refund: () => { Modal.close(); this.refund(this.root, id); },
    };
    Modal.open({
      title: `Order #${orderNo(o)} · ${whereLabel(o)}`,
      wide: true,
      body: `
        <div class="detail-head"><span class="pill ${o.status}">${o.status}</span> <span class="muted small">${fmtDateTime(this.when(o))}</span></div>
        <div class="kv-grid">
          ${kv('Opened', fmtDateTime(o.createdAt))}
          ${kv('Paid', o.paidAt ? fmtDateTime(o.paidAt) : '')}
          ${kv('Refunded', o.refundedAt ? fmtDateTime(o.refundedAt) : '')}
          ${kv('Refunded by', user(o.refundedBy))}
          ${kv('Voided', o.voidedAt ? fmtDateTime(o.voidedAt) : '')}
          ${kv('Server', esc(user(o.staffId)))}
          ${kv('Cashier', esc(user(o.cashierId)))}
          ${kv('Customer', customer ? esc(customer.name) + (o.loyalty && o.loyalty.tier ? ` (${esc(o.loyalty.tier)})` : '') : '')}
          ${kv('Discount', disc)}
          ${kv('Approved by', discBy && esc(discBy))}
          ${kv('Order note', esc(o.note || ''))}
        </div>
        <h3>Items</h3>
        <table class="data compact">
          <thead><tr><th class="num">Qty</th><th>Item</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
          <tbody>${o.items.map(l => `
            <tr>
              <td class="num">${l.qty}</td>
              <td class="wrap">${esc(l.name)}${modsText(l) ? `<div class="line-meta">${esc(modsText(l))}</div>` : ''}${l.note ? `<div class="line-note">${esc(l.note)}</div>` : ''}</td>
              <td class="num">${money(l.price)}</td>
              <td class="num">${money(l.price * l.qty)}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="empty">No items</td></tr>'}</tbody>
        </table>
        <table class="data compact totals">
          <tbody>
            ${row('Subtotal', money(t.subtotal))}
            ${t.discount ? row('Discount', '-' + money(t.discount)) : ''}
            ${t.points ? row('Points used', '-' + money(t.points)) : ''}
            ${t.service ? row(`Service ${t.serviceRate}%`, money(t.service)) : ''}
            ${row(`Tax ${t.taxRate}%`, money(t.tax))}
            ${row('TOTAL', money(t.total), 'grand')}
            ${paymentRowsHTML(o.payment, row)}
            ${o.loyalty && o.loyalty.earned ? row('Points earned', qtyText(o.loyalty.earned)) : ''}
            ${hasCost ? row('Ingredient cost', money(cost), 'muted') : ''}
          </tbody>
        </table>
        ${tickets.length ? `
          <h3>Kitchen</h3>
          <table class="data compact">
            <thead><tr><th>Sent</th><th>Ready</th><th>Served</th><th class="num">Kitchen time</th></tr></thead>
            <tbody>${tickets.map(k => `
              <tr><td>${fmtTime(k.createdAt)}</td><td>${k.readyAt ? fmtTime(k.readyAt) : '—'}</td><td>${k.servedAt ? fmtTime(k.servedAt) : '—'}</td><td class="num">${minutes(k.createdAt, k.readyAt)}</td></tr>`).join('')}
            </tbody>
          </table>` : ''}`,
      footer: `
        <button class="btn" data-act="__close">Close</button><span class="spacer"></span>
        ${o.status === 'open' && App.can('tables') ? '<button class="btn" data-act="open">Open order</button>' : ''}
        ${o.status === 'paid' || o.status === 'refunded' ? '<button class="btn primary" data-act="receipt">🧾 Receipt</button>' : ''}
        ${o.status === 'paid' && App.can('checkout') ? '<button class="btn danger" data-act="refund">Refund</button>' : ''}`,
      actions,
    });
  },

  exportCSV() {
    const list = this.shown || [];
    if (!list.length) return toast('Nothing to export', 'error');
    const [a, b] = this.bounds();
    const day = ts => isoDate(new Date(ts));
    const name = this.state.range === 'all' ? 'orders_all.csv' : `orders_${day(a)}_to_${day(b - 1)}.csv`;
    downloadFile(name, Screens.reports.csv(list), 'text/csv');
  },

  refund(root, id) {
    const order = Store.order(id);
    if (!order || order.status !== 'paid') return;
    requireManager(`Refund order #${orderNo(order)}.`, mgr => {
      confirmDialog({
        title: `Refund order #${orderNo(order)}?`,
        message: `${money(order.totals.total)} will be recorded as refunded and stock will be returned.`,
        okLabel: 'Refund',
        danger: true,
        onOk: () => {
          const o = Store.order(id);
          if (!o || o.status !== 'paid') return this.render(root);
          Store.refundOrder(o, mgr.id);
          toast(`Order #${orderNo(o)} refunded`, 'ok');
          this.render(root);
        },
      });
    });
  },
};
