'use strict';

// The order screen: menu tiles on the left, the bill on the right. The menu is in menu.js, the bill in ticket.js and the
// "more" actions (split, move table, note) in actions.js.

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
};
