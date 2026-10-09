'use strict';

// Live overview of the floor. Orders tab: every open order by stage (ordering → in the kitchen → ready to serve → waiting
// for payment) plus what was paid today. Tables tab: every table at a glance, with how long it has been seated.
Screens.dashboard = {
  perm: 'tables',
  live: ['orders', 'tables', 'guestRequests', 'kitchenTickets', 'users', 'settings'],
  state: { tab: 'orders', filter: 'all' },
  timer: null,
  root: null,

  leave() {
    clearInterval(this.timer);
    this.timer = null;
  },

  minutes(ts) { return Math.max(0, Math.floor((Date.now() - ts) / 60000)); },

  startOfDay() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  },

  // Everything the two tabs need, worked out once per render.
  gather() {
    const tickets = Store.data.kitchenTickets;
    const open = Store.openOrders().map(o => {
      const mine = tickets.filter(t => t.orderId === o.id);
      const stage = orderStage(o, mine);
      // When the order entered its current stage (what the card's timer counts from).
      let since = o.createdAt;
      if (stage === 'cooking') since = Math.min(...mine.filter(t => t.status === 'new').map(t => t.createdAt));
      else if (stage === 'ready') since = Math.min(...mine.filter(t => t.status === 'ready').map(t => t.readyAt || t.createdAt));
      else if (stage === 'payment') since = Math.max(o.createdAt, ...mine.map(t => t.servedAt || t.readyAt || t.createdAt));
      return { order: o, stage, since, total: Store.totals(o).total, items: o.items.reduce((n, l) => n + l.qty, 0) };
    }).sort((a, b) => a.since - b.since);
    const from = this.startOfDay();
    const paid = Store.data.orders.filter(o => o.status === 'paid' && o.paidAt >= from).sort((a, b) => b.paidAt - a.paidAt);
    return { open, paid, requests: App.can('guest') ? Store.pendingRequests() : [] };
  },

  render(root) {
    this.root = root;
    const st = this.state;
    const g = this.gather();
    root.innerHTML = `
      <div class="page-head">
        <h1>Dashboard</h1>
        <div class="actions">
          <div class="seg">
            <button data-act="tab" data-tab="orders" class="${st.tab === 'orders' ? 'active' : ''}">Orders</button>
            <button data-act="tab" data-tab="tables" class="${st.tab === 'tables' ? 'active' : ''}">Tables</button>
          </div>
        </div>
      </div>
      ${st.tab === 'orders' ? this.ordersHTML(g) : this.tablesHTML(g)}`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const id = t.dataset.id;
      switch (t.dataset.act) {
        case 'tab': st.tab = t.dataset.tab; this.render(root); break;
        case 'filter': st.filter = t.dataset.filter; this.render(root); break;
        case 'order': App.go('order', { orderId: id }); break;
        case 'table': {
          const order = Store.openOrderForTable(id) || Store.createOrder({ tableId: id, staffId: App.user.id });
          App.go('order', { orderId: order.id });
          break;
        }
        case 'paid': showReceipt(id); break;
        case 'served':
          Store.setTicketStatus(id, 'served', App.user.id);
          this.render(root);
          break;
      }
    };

    // Keep the "x min" timers moving.
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (App.screen === 'dashboard' && !Modal.isOpen && !App.isTyping()) this.render(this.root);
    }, 30000);
  },

  stat(label, value, sub = '', cls = '') {
    return `<div class="card stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
  },

  // ----- Orders tab -----
  ordersHTML(g) {
    const by = stage => g.open.filter(x => x.stage === stage);
    const ordering = by('ordering'), cooking = by('cooking'), ready = by('ready'), payment = by('payment');
    const sum = list => list.reduce((n, x) => n + x.total, 0);
    const oldest = list => (list.length ? this.minutes(list[0].since) : 0);
    const money$ = App.can('checkout') || App.can('reports');
    const paidTotal = g.paid.reduce((n, o) => n + Store.totals(o).total, 0);
    const column = (icon, title, list, card, cls = '') => `
      <section class="dash-col ${cls}">
        <h2><span>${icon} ${title}</span><span class="count">${list.length}</span></h2>
        <div class="dash-list">${list.map(card).join('') || '<p class="empty small">Nothing here</p>'}</div>
      </section>`;
    return `
      <div class="stats">
        ${this.stat('Open orders', g.open.length, money(sum(g.open)))}
        ${this.stat('In the kitchen', cooking.length, cooking.length ? `Longest wait ${oldest(cooking)} min` : '', cooking.length && oldest(cooking) >= 20 ? 'late' : '')}
        ${this.stat('Ready to serve', ready.length, ready.length ? `Waiting ${oldest(ready)} min` : '', ready.length ? 'ready' : '')}
        ${this.stat('Waiting for payment', payment.length, money(sum(payment)))}
        ${money$ ? this.stat('Paid today', g.paid.length, money(paidTotal)) : ''}
      </div>
      <div class="dash-board">
        ${column('✏️', 'Ordering', ordering, x => this.orderCard(x))}
        ${column('👨‍🍳', 'In the kitchen', cooking, x => this.orderCard(x))}
        ${column('🍽️', 'Ready to serve', ready, x => this.orderCard(x), 'is-ready')}
        ${column('💳', 'Waiting for payment', payment, x => this.orderCard(x))}
        ${column('✅', 'Paid today', g.paid.slice(0, 12), o => this.paidCard(o), 'is-paid')}
      </div>`;
  },

  // A card for one open order. Opening it goes to the order screen.
  orderCard({ order: o, stage, since, total, items }) {
    const staff = Store.user(o.staffId);
    const mins = this.minutes(since);
    const late = (stage === 'cooking' || stage === 'ready') && mins >= 20 ? 'late' : (stage === 'cooking' || stage === 'ready') && mins >= 10 ? 'warn' : '';
    const lines = o.items.slice(0, 3).map(l => `<li><b>${l.qty}×</b> ${esc(l.name)}</li>`).join('');
    const ticket = stage === 'ready' ? Store.data.kitchenTickets.find(t => t.orderId === o.id && t.status === 'ready') : null;
    return `
      <div class="dash-card ${stage} ${late}">
        <button class="dc-main" data-act="order" data-id="${o.id}">
          <span class="dc-top"><b>${esc(whereLabel(o))}</b><span class="muted">#${orderNo(o)}</span></span>
          <ul class="dc-items">${lines}${o.items.length > 3 ? `<li class="muted">+ ${o.items.length - 3} more</li>` : ''}${o.items.length ? '' : '<li class="muted">No items yet</li>'}</ul>
          <span class="dc-meta">${esc(staff ? staff.name : '')}${o.customerId && Store.customer(o.customerId) ? ` · 👤 ${esc(Store.customer(o.customerId).name)}` : ''}</span>
          <span class="dc-foot"><span class="dc-time"><span aria-hidden="true">🕒</span> <span>${timeAgo(since)}</span></span><b>${money(total)}</b></span>
        </button>
        ${ticket ? `<button class="btn small primary" data-act="served" data-id="${ticket.id}">✓ Served</button>` : ''}
      </div>`;
  },

  paidCard(o) {
    const staff = Store.user(o.staffId);
    return `
      <button class="dash-card paid dc-main" data-act="paid" data-id="${o.id}">
        <span class="dc-top"><b>${esc(whereLabel(o))}</b><span class="muted">#${orderNo(o)}</span></span>
        <span class="dc-meta">${esc(staff ? staff.name : '')}${o.payment ? ` · ${esc(PAY_METHODS[o.payment.method] || '')}` : ''}</span>
        <span class="dc-foot"><span class="dc-time"><span aria-hidden="true">🕒</span> <span>${timeAgo(o.paidAt)}</span></span><b>${money(Store.totals(o).total)}</b></span>
      </button>`;
  },

  // ----- Tables tab -----
  tablesHTML(g) {
    const st = this.state;
    const tables = Store.data.tables;
    const calling = new Set(g.requests.map(r => r.tableId));
    const rows = tables.map(t => {
      const x = g.open.find(o => o.order.tableId === t.id);
      return { table: t, x, status: x ? x.stage : 'free', calling: calling.has(t.id) };
    });
    const occupied = rows.filter(r => r.x);
    const attention = r => r.status === 'ready' || r.calling;
    const shown = rows.filter(r => st.filter === 'all' || (st.filter === 'free' && !r.x) || (st.filter === 'busy' && r.x) || (st.filter === 'attention' && attention(r)));
    const avg = occupied.length ? Math.round(occupied.reduce((n, r) => n + this.minutes(r.x.order.createdAt), 0) / occupied.length) : 0;
    const takeaways = g.open.filter(x => !x.order.tableId);
    const percent = tables.length ? Math.round(occupied.length / tables.length * 100) : 0;
    return `
      <div class="stats">
        ${this.stat('Occupied', occupied.length, `of ${tables.length} tables`)}
        ${this.stat('Free', tables.length - occupied.length)}
        ${this.stat('Occupancy', percent + '%')}
        ${this.stat('Average time seated', avg + ' min')}
        ${App.can('guest') ? this.stat('Guest requests', g.requests.length, '', g.requests.length ? 'late' : '') : ''}
      </div>
      <div class="toolbar">
        <div class="seg">
          ${[['all', 'All'], ['free', 'Free'], ['busy', 'Occupied'], ['attention', 'Needs attention']].map(([k, label]) =>
            `<button data-act="filter" data-filter="${k}" class="${st.filter === k ? 'active' : ''}">${label}</button>`).join('')}
        </div>
        <div class="legend">
          <span><i class="dot s-free"></i> Free</span><span><i class="dot s-ordering"></i> Ordering</span><span><i class="dot s-cooking"></i> In the kitchen</span>
          <span><i class="dot s-ready"></i> Ready to serve</span><span><i class="dot s-payment"></i> Waiting for payment</span>
        </div>
      </div>
      <div class="floor-grid">
        ${shown.map(r => this.floorTile(r)).join('') || (tables.length ? '<p class="empty">No tables match</p>' : '<p class="empty">No tables yet. Add some in Settings.</p>')}
      </div>
      ${takeaways.length && st.filter !== 'free' ? `
        <h2 class="section-title">🥡 Takeaway orders</h2>
        <div class="dash-list wide">${takeaways.map(x => this.orderCard(x)).join('')}</div>` : ''}`;
  },

  floorTile({ table: t, x, status, calling }) {
    const staff = x && Store.user(x.order.staffId);
    const label = { free: 'Free', ordering: 'Ordering', cooking: 'In the kitchen', ready: 'Ready to serve', payment: 'Waiting for payment' }[status];
    const late = x && (status === 'cooking' || status === 'ready') && this.minutes(x.since) >= 20;
    return `
      <button class="floor-tile s-${status} ${calling ? 'calling' : ''} ${late ? 'late' : ''}" data-act="table" data-id="${t.id}">
        <span class="ft-name">${esc(t.name)}</span>
        <span class="ft-status">${label}</span>
        ${x ? `
          <span class="ft-meta">${x.items} item${x.items === 1 ? '' : 's'} · ${esc(staff ? staff.name : '')}</span>
          <span class="ft-meta"><span>Seated</span> <span>${timeAgo(x.order.createdAt)}</span></span>
          <span class="ft-total">${money(x.total)}</span>` : '<span class="ft-meta">Tap to start an order</span>'}
        ${calling || status === 'ready' ? `<span class="t-bell">${status === 'ready' ? '🍽️' : ''}${calling ? '🔔' : ''}</span>` : ''}
      </button>`;
  },
};
