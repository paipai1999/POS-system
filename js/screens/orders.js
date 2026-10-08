'use strict';

Screens.orders = {
  perm: 'orders',
  live: ['orders', 'users'],
  state: { range: 'today', status: 'all', q: '' },

  from() {
    if (this.state.range === 'all') return 0;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (this.state.range === 'week') start.setDate(start.getDate() - 6);
    return start.getTime();
  },

  list() {
    const st = this.state;
    const from = this.from();
    const q = st.q.trim().toLowerCase();
    return Store.data.orders
      .filter(o => App.user.role !== 'waiter' || o.staffId === App.user.id)
      .filter(o => o.createdAt >= from)
      .filter(o => st.status === 'all' || o.status === st.status)
      .filter(o => !q || String(o.number).includes(q) || whereLabel(o).toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 300);
  },

  rows() {
    if (!Sync.ordersLoaded(this.from())) return '<tr><td colspan="9" class="empty">Loading older orders…</td></tr>';
    const list = this.list();
    if (!list.length) return '<tr><td colspan="9" class="empty">No orders found</td></tr>';
    return list.map(o => {
      const staff = Store.user(o.staffId);
      const items = o.items.reduce((n, l) => n + l.qty, 0);
      return `
        <tr>
          <td><b>#${orderNo(o)}</b></td>
          <td>${fmtDateTime(o.paidAt || o.createdAt)}</td>
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

  render(root) {
    const st = this.state;
    const from = this.from();
    if (!Sync.ordersLoaded(from)) {
      Sync.loadOrders(from)
        .then(() => { if (App.screen === 'orders') App.refreshScreen(); })
        .catch(e => toast(e.message, 'error'));
    }
    root.innerHTML = `
      <div class="page-head"><h1>${App.user.role === 'waiter' ? 'My orders' : 'Orders'}</h1></div>
      <div class="toolbar">
        <div class="seg">
          ${[['today', 'Today'], ['week', '7 days'], ['all', 'All']].map(([k, label]) =>
            `<button data-act="range" data-range="${k}" class="${st.range === k ? 'active' : ''}">${label}</button>`).join('')}
        </div>
        <select class="input" data-role="status">
          ${['all', 'open', 'paid', 'refunded', 'void'].map(s => `<option value="${s}" ${st.status === s ? 'selected' : ''}>${s === 'all' ? 'All statuses' : s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
        </select>
        <input class="input" type="search" data-role="q" placeholder="Search # or table…" value="${esc(st.q)}">
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>#</th><th>Time</th><th>Table</th><th>Server</th><th class="num">Items</th><th class="num">Total</th><th>Paid by</th><th>Status</th><th></th></tr></thead>
          <tbody>${this.rows()}</tbody>
        </table>
      </div>`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const id = t.dataset.id;
      switch (t.dataset.act) {
        case 'range': st.range = t.dataset.range; this.render(root); break;
        case 'open': App.go('order', { orderId: id }); break;
        case 'receipt': showReceipt(id); break;
        case 'refund': this.refund(root, id); break;
      }
    };
    root.oninput = e => {
      if (e.target.dataset.role !== 'q') return;
      st.q = e.target.value;
      root.querySelector('tbody').innerHTML = this.rows();
    };
    root.onchange = e => {
      if (e.target.dataset.role !== 'status') return;
      st.status = e.target.value;
      root.querySelector('tbody').innerHTML = this.rows();
    };
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
