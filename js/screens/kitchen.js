'use strict';

// Kitchen display: tickets appear when a waiter taps "Send"; the cook taps Ready and the waiter is notified.
Screens.kitchen = {
  perm: 'kitchen',
  live: ['kitchenTickets', 'orders', 'users'],
  timer: null,
  root: null,

  leave() {
    clearInterval(this.timer);
    this.timer = null;
  },

  render(root) {
    this.root = root;
    const queue = Store.data.kitchenTickets.filter(t => t.status === 'new').sort((a, b) => a.createdAt - b.createdAt);
    const ready = Store.data.kitchenTickets.filter(t => t.status === 'ready').sort((a, b) => b.readyAt - a.readyAt).slice(0, 12);
    root.innerHTML = `
      <div class="page-head">
        <h1>Kitchen</h1>
        <div class="actions"><span class="muted">${queue.length} ticket${queue.length === 1 ? '' : 's'} waiting</span></div>
      </div>
      <div class="kds">${queue.map(t => this.card(t)).join('') || '<p class="empty kds-empty">No orders waiting 🎉</p>'}</div>
      ${ready.length ? `
        <h2 class="section-title">Ready — waiting for pickup</h2>
        <div class="kds done">${ready.map(t => this.readyCard(t)).join('')}</div>` : ''}`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'ready') Store.setTicketStatus(t.dataset.id, 'ready', App.user.id);
      else if (t.dataset.act === 'undo') Store.setTicketStatus(t.dataset.id, 'new', App.user.id);
      this.render(root);
    };

    // Keep the "x min" timers moving.
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (App.screen === 'kitchen' && !Modal.isOpen) this.render(this.root);
    }, 15000);
  },

  minutes(ts) { return Math.max(0, Math.floor((Date.now() - ts) / 60000)); },

  head(t) {
    const staff = Store.user(t.staffId);
    return `
      <header>
        <b>${esc(t.where)}</b>
        <span>#${orderNo(Store.order(t.orderId) || t)}</span>
      </header>
      <div class="kds-meta">${esc(staff ? staff.name : '')} · ${fmtTime(t.createdAt)}</div>`;
  },

  card(t) {
    const mins = this.minutes(t.createdAt);
    return `
      <div class="kds-card ${mins >= 20 ? 'late' : mins >= 10 ? 'warn' : ''}">
        ${this.head(t)}
        <div class="kds-time">${mins} min</div>
        <ul class="kds-items">
          ${t.items.map(l => `<li><b>${l.qty}×</b> ${esc(l.name)}${l.mods && l.mods.length ? `<div class="line-note">${esc('+ ' + l.mods.join(', '))}</div>` : ''}${l.note ? `<div class="line-note">» ${esc(l.note)}</div>` : ''}</li>`).join('')}
        </ul>
        ${t.note ? `<div class="order-note">📝 ${esc(t.note)}</div>` : ''}
        <button class="btn primary big" data-act="ready" data-id="${t.id}">✓ Ready</button>
      </div>`;
  },

  readyCard(t) {
    return `
      <div class="kds-card is-ready">
        ${this.head(t)}
        <ul class="kds-items">${t.items.map(l => `<li><b>${l.qty}×</b> ${esc(l.name)}</li>`).join('')}</ul>
        <button class="btn small" data-act="undo" data-id="${t.id}">↩ Not ready</button>
      </div>`;
  },
};
