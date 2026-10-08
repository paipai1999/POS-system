'use strict';

const QUICK_NOTES = ['No ice', 'Less sugar', 'Oat milk', 'Extra hot', 'No onions', 'Spicy', 'Allergy'];

Screens.order = {
  perm: 'tables',
  live: ['orders', 'products', 'categories', 'kitchenTickets', 'settings', 'users'],
  state: { cat: 'all', q: '' },
  root: null,
  orderId: null,

  order() { return Store.order(this.orderId); },

  // Called when another device changed data this screen shows.
  refresh() {
    const order = this.order();
    if (!order || order.status !== 'open') {
      // Our own payment coming back from the server: the receipt dialog is showing and takes us back to Tables when closed.
      if (order && order.status === 'paid' && order.cashierId === App.user.id && Modal.isOpen) return refreshReceipt(order.id);
      if (order) toast(`Order #${orderNo(order)} was ${order.status} on another device`);
      return App.go('tables');
    }
    this.update();
  },

  leave(params) {
    this.state.q = '';
    const o = Store.order(params.orderId);
    if (o && o.status === 'open' && !o.items.length) Store.removeOrder(o.id);
  },

  render(root, params) {
    this.root = root;
    this.orderId = params.orderId;
    const order = this.order();
    if (!order || order.status !== 'open') return App.go('tables');
    const st = this.state;
    const cats = Store.data.categories;
    if (st.cat !== 'all' && !Store.category(st.cat)) st.cat = 'all';

    root.innerHTML = `
      <div class="order-layout">
        <section class="menu-pane">
          <input class="input" type="search" placeholder="Search menu…" value="${esc(st.q)}" data-role="search">
          <div class="chips">
            <button class="chip ${st.cat === 'all' ? 'active' : ''}" data-act="cat" data-id="all">All</button>
            ${cats.map(c => `<button class="chip ${st.cat === c.id ? 'active' : ''}" data-act="cat" data-id="${c.id}">${esc(c.name)}</button>`).join('')}
          </div>
          <div class="product-grid">${this.productTiles()}</div>
        </section>
        <aside class="ticket">${this.ticketHTML(order)}</aside>
      </div>`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      const id = t.dataset.id;
      switch (t.dataset.act) {
        case 'cat': st.cat = id; this.render(root, params); break;
        case 'add': this.add(id); break;
        case 'inc': this.changeQty(id, 1); break;
        case 'dec': this.changeQty(id, -1); break;
        case 'edit-line': this.editLine(id); break;
        case 'back': App.go('tables'); break;
        case 'send': this.sendToKitchen(); break;
        case 'bill': printHTML(receiptHTML(this.order())); break;
        case 'served':
          Store.readyTickets().filter(k => k.orderId === this.orderId).forEach(k => Store.setTicketStatus(k.id, 'served', App.user.id));
          this.update();
          break;
        case 'pay': Checkout.open(this.orderId); break;
        case 'more': this.moreMenu(); break;
      }
    };
    root.oninput = e => {
      if (e.target.dataset.role !== 'search') return;
      st.q = e.target.value;
      root.querySelector('.product-grid').innerHTML = this.productTiles();
    };
  },

  // Re-renders the ticket and product grid without losing the menu's scroll position or search focus.
  update() {
    const order = this.order();
    if (!order || order.status !== 'open' || !this.root) return;
    this.root.querySelector('.ticket').innerHTML = this.ticketHTML(order);
    this.root.querySelector('.product-grid').innerHTML = this.productTiles();
  },

  productTiles() {
    const st = this.state;
    const q = st.q.trim().toLowerCase();
    const list = Store.data.products.filter(p =>
      p.active && (st.cat === 'all' || p.categoryId === st.cat) && (!q || p.name.toLowerCase().includes(q)));
    if (!list.length) return '<p class="empty">No items found</p>';
    return list.map(p => {
      const avail = Store.available(p);
      const out = avail <= 0;
      return `
        <button class="product-tile ${out ? 'soldout' : ''}" data-act="add" data-id="${p.id}" ${out ? 'disabled' : ''}>
          <span class="p-emoji">${esc(p.emoji || '🍽️')}</span>
          <span class="p-name">${esc(p.name)}</span>
          ${p.trackStock ? `<span class="p-stock ${avail <= p.lowStock ? 'low' : ''}">${out ? 'Sold out' : avail + ' left'}</span>` : ''}
          <span class="p-price">${money(p.price)}</span>
        </button>`;
    }).join('');
  },

  ticketHTML(order) {
    const t = Store.totals(order);
    const staff = Store.user(order.staffId);
    const unsent = order.items.reduce((n, l) => n + Math.max(0, l.qty - l.sentQty), 0);
    const empty = !order.items.length;
    const ready = Store.readyTickets().some(k => k.orderId === order.id);
    return `
      <div class="ticket-head">
        <button class="btn small" data-act="back">← Tables</button>
        <div class="grow">
          <div class="t-title">${esc(whereLabel(order))}</div>
          <div class="muted small">#${orderNo(order)} · ${esc(staff ? staff.name : '')} · ${fmtTime(order.createdAt)}</div>
          ${order.customerId && Store.customer(order.customerId) ? `<div class="small">👤 ${esc(Store.customer(order.customerId).name)}</div>` : ''}
        </div>
        <button class="icon-btn" data-act="more" title="More options" aria-label="More options">⋯</button>
      </div>
      ${ready ? '<div class="ready-banner">🍽️ Food is ready in the kitchen <button class="btn small" data-act="served">Mark served</button></div>' : ''}
      ${order.note ? `<div class="order-note">📝 ${esc(order.note)}</div>` : ''}
      <div class="ticket-lines">
        ${empty ? '<p class="empty">Tap menu items to add them</p>' : order.items.map(l => `
          <div class="line">
            <div class="line-main" data-act="edit-line" data-id="${l.id}" title="Add note / remove">
              <div class="line-name">${esc(l.name)}</div>
              ${modsText(l) ? `<div class="line-mods">${esc(modsText(l))}</div>` : ''}
              ${l.note ? `<div class="line-note">${esc(l.note)}</div>` : ''}
              <div class="line-meta">${money(l.price)}${l.sentQty ? ` · <span class="sent">✓ ${l.sentQty} sent</span>` : ''}</div>
            </div>
            <div class="qty">
              <button data-act="dec" data-id="${l.id}" aria-label="Less">−</button>
              <span>${l.qty}</span>
              <button data-act="inc" data-id="${l.id}" aria-label="More">+</button>
            </div>
            <div class="line-total">${money(l.price * l.qty)}</div>
          </div>`).join('')}
      </div>
      <div class="totals">${totalsHTML(t)}</div>
      <div class="ticket-actions">
        <button class="btn" data-act="send" ${unsent ? '' : 'disabled'}>🍳 Send${unsent ? ` (${unsent})` : ''}</button>
        <button class="btn" data-act="bill" ${empty ? 'disabled' : ''}>🧾 Print bill</button>
        ${App.can('checkout') ? `<button class="btn primary big span-2" data-act="pay" ${empty ? 'disabled' : ''}>Pay ${money(t.total)}</button>` : ''}
      </div>`;
  },

  add(productId) {
    const order = this.order();
    const p = Store.product(productId);
    if (!order || !p) return;
    if (Store.available(p) < 1) return toast(`${p.name} is out of stock`, 'error');
    if (p.options && p.options.length) return this.pickOptions(p);
    Store.addItem(order, p);
    Store.save();
    this.update();
  },

  // Items with priced options (extra shot, large…): tick the ones the guest wants, then add.
  pickOptions(p) {
    const base = lineUnitPrice(p, []);
    const picked = () => [...Modal.el().querySelectorAll('[name=opt]:checked')].map(i => p.options[+i.value]);
    const refresh = () => {
      Modal.el().querySelector('[data-role=sum]').textContent = money(lineUnitPrice(p, picked()));
    };
    const actions = {
      __change: e => { if (e.target.name === 'opt') refresh(); },
      add: () => {
        const o = this.order();
        if (!o || Store.available(p) < 1) return Modal.close();
        Store.addItem(o, p, 1, '', picked());
        Store.save();
        Modal.close();
        this.update();
      },
    };
    actions.__enter = actions.add;
    Modal.open({
      title: p.name,
      body: `
        <div class="opt-list">
          ${p.options.map((o, i) => `
            <label class="opt-row"><span><input type="checkbox" name="opt" value="${i}"> ${esc(o.name)}</span><span>${o.price ? '+' + money(o.price) : ''}</span></label>`).join('')}
        </div>
        <div class="totals-inline spaced"><span>Price</span><b data-role="sum">${money(base)}</b></div>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="add">Add to order</button>',
      actions,
    });
  },

  changeQty(lineId, delta) {
    const order = this.order();
    const line = order && order.items.find(l => l.id === lineId);
    if (!line) return;
    const newQty = line.qty + delta;
    if (delta > 0) {
      const p = Store.product(line.productId);
      if (p && Store.available(p) < delta) return toast(`${p.name} is out of stock`, 'error');
    }
    const apply = () => {
      const o = this.order();
      const l = o && o.items.find(x => x.id === lineId);
      if (!l) return;
      l.qty = newQty;
      l.sentQty = Math.min(l.sentQty, newQty);
      if (l.qty <= 0) o.items = o.items.filter(x => x !== l);
      Store.save();
      this.update();
    };
    if (newQty < line.sentQty) requireManager(`Remove "${line.name}" — it was already sent to the kitchen.`, apply);
    else apply();
  },

  editLine(lineId) {
    const order = this.order();
    const line = order && order.items.find(l => l.id === lineId);
    if (!line) return;
    const actions = {
      quick: t => {
        const input = Modal.el().querySelector('[name=note]');
        input.value = input.value ? `${input.value}, ${t.dataset.note}` : t.dataset.note;
      },
      save: () => {
        const note = Modal.el().querySelector('[name=note]').value.trim();
        const o = this.order();
        const l = o && o.items.find(x => x.id === lineId);
        if (l) { l.note = note; Store.save(); }
        Modal.close();
        this.update();
      },
      remove: () => { Modal.close(); this.changeQty(lineId, -line.qty); },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: line.name,
      body: `
        <label class="field"><span>Note for the kitchen</span>
          <input class="input" name="note" value="${esc(line.note)}" placeholder="e.g. no onions, oat milk" autofocus></label>
        <div class="chips wrap">${QUICK_NOTES.map(n => `<button class="chip" data-act="quick" data-note="${esc(n)}">${esc(n)}</button>`).join('')}</div>`,
      footer: `<button class="btn danger" data-act="remove">Remove item</button><span class="spacer"></span>
        <button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>`,
      actions,
    });
  },

  sendToKitchen() {
    const order = this.order();
    if (!order) return;
    const lines = order.items.filter(l => l.qty > l.sentQty).map(l => ({ ...l, qty: l.qty - l.sentQty }));
    if (!lines.length) return toast('Nothing new to send');
    order.items.forEach(l => { l.sentQty = l.qty; });
    order.sentAt = Date.now();
    Store.addKitchenTicket(order, lines);
    this.update();
    toast(`Sent ${lines.reduce((n, l) => n + l.qty, 0)} item(s) to the kitchen`, 'ok');
    if (Store.settings.printKitchenTickets) printHTML(kitchenTicketHTML(order, lines), 'kitchen');
  },

  moreMenu() {
    const order = this.order();
    if (!order) return;
    Modal.open({
      title: `Order #${orderNo(order)}`,
      body: `
        <div class="stack">
          <button class="btn block" data-act="note">📝 Order note</button>
          <button class="btn block" data-act="move">🔀 Move to another table</button>
          <button class="btn block" data-act="split" ${order.items.length > 1 || order.items.some(l => l.qty > 1) ? '' : 'disabled'}>✂️ Split the bill</button>
          <button class="btn block danger" data-act="void">🗑️ Void order</button>
        </div>`,
      actions: {
        note: () => this.editOrderNote(),
        move: () => this.moveTable(),
        split: () => this.splitBill(),
        void: () => requireManager('Void this whole order.', mgr => {
          confirmDialog({
            title: `Void order #${orderNo(order)}?`,
            message: 'The order will be cancelled and kept in history as void.',
            okLabel: 'Void order',
            danger: true,
            onOk: () => {
              Store.voidOrder(this.order(), mgr.id);
              toast('Order voided');
              App.go('tables');
            },
          });
        }),
      },
    });
  },

  // Pick which items (and how many) go onto a separate bill, e.g. when friends pay separately.
  splitBill() {
    const order = this.order();
    if (!order) return;
    const moves = {}; // line id -> quantity to move
    const total = () => order.items.reduce((n, l) => n + l.qty, 0);
    const moving = () => Object.values(moves).reduce((n, q) => n + q, 0);
    const linesHTML = () => order.items.map(l => `
      <div class="line">
        <div class="line-main"><div class="line-name">${esc(l.name)}</div>${modsText(l) ? `<div class="line-mods">${esc(modsText(l))}</div>` : ''}<div class="line-meta">${money(l.price)} × ${l.qty}</div></div>
        <div class="qty"><button data-act="less" data-id="${l.id}" aria-label="Less">−</button><span>${moves[l.id] || 0}</span><button data-act="more" data-id="${l.id}" aria-label="More">+</button></div>
      </div>`).join('');
    const refresh = () => {
      const m = Modal.el();
      m.querySelector('[data-role=lines]').innerHTML = linesHTML();
      m.querySelector('[data-role=go]').disabled = moving() === 0 || moving() >= total();
    };
    Modal.open({
      title: `Split bill #${orderNo(order)}`,
      body: `
        <p class="muted small">Choose what goes on the new bill. The new bill is paid separately; the rest stays here.</p>
        <div class="split-lines" data-role="lines">${linesHTML()}</div>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="go" data-role="go" disabled>Move to a new bill</button>',
      actions: {
        more: t => {
          const l = order.items.find(x => x.id === t.dataset.id);
          if (l && (moves[l.id] || 0) < l.qty) moves[l.id] = (moves[l.id] || 0) + 1;
          refresh();
        },
        less: t => {
          if (moves[t.dataset.id] > 0) moves[t.dataset.id]--;
          if (!moves[t.dataset.id]) delete moves[t.dataset.id];
          refresh();
        },
        go: async () => {
          const list = Object.entries(moves).map(([lineId, qty]) => ({ lineId, qty }));
          try {
            const created = await Store.splitOrder(order, list);
            Modal.close();
            toast(`New bill #${orderNo(created)} created`, 'ok');
            App.go('order', { orderId: created.id });
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      },
    });
  },

  editOrderNote() {
    const order = this.order();
    const actions = {
      save: () => {
        const o = this.order();
        if (o) o.note = Modal.el().querySelector('[name=note]').value.trim();
        Store.save();
        Modal.close();
        App.render();
      },
    };
    Modal.open({
      title: 'Order note',
      body: `<label class="field"><span>Shown on the ticket and kitchen print-out</span>
        <textarea class="input" name="note" rows="3" autofocus>${esc(order.note)}</textarea></label>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>',
      actions,
    });
  },

  moveTable() {
    const order = this.order();
    const free = Store.data.tables.filter(t => !Store.openOrderForTable(t.id));
    Modal.open({
      title: 'Move to table',
      body: free.length
        ? `<div class="user-grid">${free.map(t => `<button class="user-tile" data-act="pick" data-id="${t.id}"><span>${esc(t.name)}</span></button>`).join('')}</div>`
        : '<p class="empty">No free tables.</p>',
      actions: {
        pick: t => {
          const table = Store.table(t.dataset.id);
          const o = this.order();
          if (!table || !o) return Modal.close();
          if (Store.openOrderForTable(table.id)) return toast(`${table.name} is already in use`, 'error');
          o.tableId = table.id;
          o.tableName = table.name;
          Store.save();
          Modal.close();
          toast(`Moved to ${table.name}`, 'ok');
          App.render();
        },
      },
    });
  },
};
