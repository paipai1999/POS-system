'use strict';

// Bills: creating and changing an order, paying, refunding, voiding, splitting, and the kitchen tickets that follow.
Object.assign(Store, {
  openOrders() { return this.data.orders.filter(o => o.status === 'open'); },

  openOrderForTable(tableId) { return this.data.orders.find(o => o.status === 'open' && o.tableId === tableId); },

  readyTickets() {
    return this.data.kitchenTickets.filter(t => t.status === 'ready').sort((a, b) => a.readyAt - b.readyAt);
  },

  // Stock is deducted at payment, so items sitting on open orders count as reserved.
  reservedQty(productId) {
    let n = 0;
    for (const o of this.data.orders) {
      if (o.status !== 'open') continue;
      for (const l of o.items) if (l.productId === productId) n += l.qty;
    }
    return n;
  },

  // How many more of this item can be sold: limited by its own stock and, when "stop selling" is on, by its ingredients.
  available(product) {
    let n = product.trackStock ? product.stock - this.reservedQty(product.id) : Infinity;
    if (ingredientStockMode(this.settings) === 'block') n = Math.min(n, this.ingredientPortions(product));
    return n;
  },

  // Portions the ingredients still allow, after what open bills already hold. A device that is not sent ingredient figures
  // (a cashier's or waiter's) relies on the server's list of what each dish is short of.
  ingredientPortions(product) {
    if (!this.data.ingredients.length) return product.lacks && product.lacks.length ? 0 : Infinity;
    const recipe = recipeOf(product);
    if (!recipe.length) return Infinity;
    const held = ingredientNeeds(this.openOrders().flatMap(o => o.items), id => this.product(id));
    let portions = Infinity;
    for (const r of recipe) {
      const ing = this.ingredient(r.ingredientId);
      if (!ing || ing.watch === false || ing.active === false) continue;
      portions = Math.min(portions, Math.floor(((ing.stock || 0) - (held.get(ing.id) || 0) + 1e-9) / r.qty));
    }
    return portions;
  },

  createOrder({ tableId = null, staffId }) {
    const table = tableId ? this.table(tableId) : null;
    const order = {
      id: uid('o_'),
      // In server mode the server numbers orders, so two devices can never hand out the same number.
      number: this.server ? null : this.settings.nextOrderNo++,
      tableId,
      tableName: table ? table.name : '',
      staffId,
      status: 'open',
      items: [],
      note: '',
      discount: null,
      createdAt: Date.now(),
    };
    this.data.orders.push(order);
    this.save();
    return order;
  },

  removeOrder(id) {
    this.data.orders = this.data.orders.filter(o => o.id !== id);
    this.save();
  },

  // Name and price are copied onto the line so later menu edits don't change past orders.
  // `mods` are priced options picked for this line (extra shot, large…); they raise the line's price.
  addItem(order, product, qty = 1, note = '', mods = []) {
    const same = l => l.productId === product.id && !l.note && JSON.stringify(l.mods || []) === JSON.stringify(mods);
    const line = !note && order.items.find(same);
    if (line) line.qty += qty;
    else {
      const l = { id: uid('l_'), productId: product.id, name: product.name, price: lineUnitPrice(product, mods), qty, note, sentQty: 0 };
      if (mods.length) l.mods = mods.map(m => ({ name: m.name, price: m.price }));
      order.items.push(l);
    }
  },

  // Moves some lines of an open bill onto a new bill ("split the bill"). Returns the new order.
  // In server mode the server does it in one step so nothing can be lost; local mode does the same here.
  async splitOrder(order, moves) {
    if (this.server) {
      await Sync.flush();
      const base = (Sync.synced.orders && Sync.synced.orders[order.id] || {}).ver || 0;
      const res = await Sync.api('/api/orders/split', { method: 'POST', body: { orderId: order.id, base, moves } });
      Sync.applyRemote(res.rows, { advanceSeq: false });
      return this.order(res.rows[1].data.id);
    }
    const items = order.items.map(l => ({ ...l }));
    const moved = [];
    for (const mv of moves) {
      const line = items.find(l => l.id === mv.lineId);
      if (!line || !(mv.qty >= 1 && mv.qty <= line.qty)) throw new Error('Invalid split');
      const sent = Math.min(line.sentQty || 0, mv.qty);
      moved.push({ ...line, id: uid('l_'), qty: mv.qty, sentQty: sent });
      line.qty -= mv.qty;
      line.sentQty = Math.max(0, (line.sentQty || 0) - sent);
    }
    const rest = items.filter(l => l.qty > 0);
    if (!rest.length) throw new Error('Leave at least one item on the original bill');
    order.items = rest;
    const created = this.createOrder({ tableId: null, staffId: order.staffId });
    created.tableName = (order.tableId && (this.table(order.tableId) || {}).name) || order.tableName || '';
    created.splitFrom = order.id;
    created.items = moved;
    this.save();
    return created;
  },

  totals(order) {
    if (order.status !== 'open' && order.totals) return order.totals;
    return computeTotals(order, this.settings);
  },

  // In server mode the server adjusts stock when it sees the status change (see server/sync.js).
  // The payment is checked and the figures worked out by the same rules the server applies (shared.js settleOrder);
  // throws an Error with a message for the cashier if it does not add up.
  payOrder(order, payment, cashierId) {
    const customer = order.customerId ? this.customer(order.customerId) : null;
    const settled = settleOrder(order, payment, this.settings, customer);   // checks the credit limit when a part goes on account
    const cust = !this.server && customer;
    if (cust && settled.totals.points > (cust.points || 0) + 0.005) throw new Error('The customer does not have that many points');
    order.totals = settled.totals;
    order.payment = settled.payment;
    order.status = 'paid';
    order.paidAt = Date.now();
    order.cashierId = cashierId;
    if (!this.server) {
      // The server does all of this itself in server mode; single-device mode does it here with the same rules (shared.js).
      takeStockLines(order.items, id => this.product(id));
      consumeIngredients(order.items, id => this.product(id), id => this.ingredient(id));
      if (cust) {
        applyLoyalty(order, cust, this.settings);
        const credit = paymentByMethod(order.payment).credit || 0;
        if (credit) cust.owing = roundTo((cust.owing || 0) + credit, decimalsOf(this.settings));   // what goes on account is owed
      }
    }
    this.save();
  },

  refundOrder(order, byId) {
    order.status = 'refunded';
    order.refundedAt = Date.now();
    order.refundedBy = byId;
    if (!this.server) {
      returnStockLines(order.items, id => this.product(id));
      restoreIngredients(order.items, id => this.ingredient(id));
      const cust = order.customerId && this.customer(order.customerId);
      if (cust) {
        if (order.loyalty) reverseLoyalty(order, cust, this.settings);
        const credit = paymentByMethod(order.payment).credit || 0;
        if (credit) cust.owing = roundTo((cust.owing || 0) - credit, decimalsOf(this.settings));
      }
    }
    this.save();
  },

  voidOrder(order, byId) {
    order.status = 'void';
    order.voidedAt = Date.now();
    order.voidedBy = byId;
    for (const t of this.data.kitchenTickets) {
      if (t.orderId === order.id && t.status !== 'served') t.status = 'void';
    }
    this.save();
  },

  addKitchenTicket(order, lines) {
    this.data.kitchenTickets.push({
      id: uid('k_'),
      orderId: order.id,
      orderNo: order.number,
      where: whereLabel(order),
      staffId: order.staffId,
      items: lines.map(l => ({ name: l.name, qty: l.qty, note: l.note, ...(l.mods && l.mods.length ? { mods: l.mods.map(m => m.name) } : {}) })),
      note: order.note,
      status: 'new',
      createdAt: Date.now(),
    });
    if (!this.server) {
      const dayAgo = Date.now() - 86400000;
      this.data.kitchenTickets = this.data.kitchenTickets.filter(t => t.createdAt > dayAgo || t.status === 'new' || t.status === 'ready');
    }
    this.save();
  },

  setTicketStatus(id, status, byId) {
    const t = this.data.kitchenTickets.find(x => x.id === id);
    if (!t) return;
    t.status = status;
    if (status === 'ready') { t.readyAt = Date.now(); t.readyBy = byId; }
    if (status === 'served') { t.servedAt = Date.now(); t.servedBy = byId; }
    if (status === 'new') { delete t.readyAt; delete t.readyBy; }
    this.save();
  },
});
