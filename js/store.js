'use strict';

// Local mode: all data lives in localStorage under one key (opening index.html directly).
// Server mode: data comes from the POS server and every save() is synced by Sync (js/sync.js).
const STORE_KEY = 'restaurant-pos-v1';

const Store = {
  data: null,
  mode: 'local',

  get server() { return this.mode === 'server'; },

  load() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { data = null; }
    if (this.isValid(data)) {
      this.data = this.normalize(data);
      // Open orders left empty (e.g. the tab was closed on the order screen) would show a table as busy forever.
      this.data.orders = this.data.orders.filter(o => o.status !== 'open' || o.items.length);
    } else {
      this.data = seedData();
      this.save();
    }
  },

  // Fills in fields that older or hand-edited backups may lack.
  normalize(data) {
    normalizeDataset(data);
    const defaults = seedData().settings;
    data.settings = { ...defaults, ...data.settings };
    const maxNo = data.orders.reduce((m, o) => Math.max(m, Number(o.number) || 0), 0);
    data.settings.nextOrderNo = Math.max(Number(data.settings.nextOrderNo) || 1, maxNo + 1); // never reuse an order number
    this.sortCategories(data);
    return data;
  },

  // Applies a change made by another tab. Returns false (keeping current data) if the new value is unusable,
  // so a cleared or corrupt storage entry in one tab cannot wipe the data in another.
  syncFrom(raw) {
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!this.isValid(data)) return false;
    this.data = this.normalize(data);
    return true;
  },

  save() {
    if (this.server) return Sync.schedule();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    } catch (e) {
      alert('Could not save data: browser storage is full or blocked. Export a backup and clear old orders.');
    }
  },

  isValid(d) { return isValidDataset(d); },

  reset() { this.data = seedData(); this.save(); },

  replace(data) {
    this.data = this.normalize(data);
    this.save();
  },

  get settings() { return this.data.settings; },

  user(id) { return this.data.users.find(u => u.id === id); },
  product(id) { return this.data.products.find(p => p.id === id); },
  category(id) { return this.data.categories.find(c => c.id === id); },
  table(id) { return this.data.tables.find(t => t.id === id); },
  order(id) { return this.data.orders.find(o => o.id === id); },
  ingredient(id) { return this.data.ingredients.find(i => i.id === id); },
  customer(id) { return this.data.customers.find(c => c.id === id); },
  userByPin(pin) { return this.data.users.find(u => u.active && u.pin === pin); },

  sortCategories(data = this.data) {
    data.categories.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  },

  // PINs are only checked locally in local mode; in server mode the server checks them and never sends them out.
  async login(userId, pin) {
    if (this.server) return Sync.login(userId, pin);
    const user = this.user(userId);
    if (!user || !user.active || user.pin !== pin) throw new Error('Incorrect PIN');
    return user;
  },

  async verifyPin(pin) {
    if (this.server) return Sync.verifyPin(pin);
    const user = this.userByPin(pin);
    if (!user) throw new Error('Wrong PIN');
    return user;
  },

  // PINs that ship with the demo data. A user who signs in with one is asked to choose their own.
  DEMO_PINS: ['1234', '1111', '2222', '3333'],

  mustChangePin(user) {
    if (!user) return false;
    return this.server ? !!Sync.mustChangePin : this.DEMO_PINS.includes(user.pin);
  },

  async changeOwnPin(pin) {
    if (this.server) {
      await Sync.api('/api/me/pin', { method: 'POST', body: { pin } });
      Sync.mustChangePin = false;
      return;
    }
    const me = this.user(App.user.id);
    if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must be 4–6 digits');
    if (this.DEMO_PINS.includes(pin) || /^(\d)\1+$/.test(pin)) throw new Error('That PIN is too easy to guess. Choose another.');
    if (this.data.users.some(u => u.id !== me.id && u.pin === pin)) throw new Error('That PIN is already used by someone else');
    me.pin = pin;
    this.save();
  },

  openOrders() { return this.data.orders.filter(o => o.status === 'open'); },
  openOrderForTable(tableId) { return this.data.orders.find(o => o.status === 'open' && o.tableId === tableId); },
  pendingRequests() {
    return this.data.guestRequests.filter(r => r.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
  },
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

  available(product) {
    return product.trackStock ? product.stock - this.reservedQty(product.id) : Infinity;
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

  // ----- cash drawer -----
  openShift() { return this.data.shifts.find(s => !s.closedAt) || null; },

  startShift(openingFloat) {
    const shift = { id: uid('s_'), openingFloat: rmoney(openingFloat), openedAt: Date.now(), openedBy: App.user.id, closedAt: null };
    this.data.shifts.push(shift);
    this.save();
    return shift;
  },

  // The server works out the expected cash itself; in local mode it is worked out here.
  closeShift(shift, countedCash, note) {
    shift.countedCash = rmoney(countedCash);
    shift.note = note;
    if (!this.server) {
      shift.closedAt = Date.now();
      shift.closedBy = App.user.id;
      const sums = computeShift(shift, this.data.orders, decimalsOf(this.settings));
      Object.assign(shift, { expectedCash: sums.expected, difference: rmoney(shift.countedCash - sums.expected), cashIn: sums.cashIn, cashOut: sums.cashOut, tips: sums.tips, sales: sums.sales, orders: sums.orders });
    } else {
      shift.closedAt = Date.now(); // marks the close request; the server replaces every figure
    }
    this.save();
  },

  totals(order) {
    if (order.status !== 'open' && order.totals) return order.totals;
    return computeTotals(order, this.settings);
  },

  // In server mode the server adjusts stock when it sees the status change (see server/sync.js).
  // The payment is checked and the figures worked out by the same rules the server applies (shared.js settleOrder);
  // throws an Error with a message for the cashier if it does not add up.
  payOrder(order, payment, cashierId) {
    const settled = settleOrder(order, payment, this.settings);
    const cust = !this.server && order.customerId && this.customer(order.customerId);
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
      if (cust) applyLoyalty(order, cust, this.settings);
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
      const cust = order.loyalty && this.customer(order.loyalty.customerId);
      if (cust) reverseLoyalty(order, cust, this.settings);
    }
    this.save();
  },

  // ----- ingredients: purchases and stocktakes -----
  // In server mode the server adds the stock (and works out the cost) itself; single-device mode does it here.
  addPurchase({ supplier = '', note = '', lines }) {
    const dec = decimalsOf(this.settings);
    const purchase = {
      id: uid('pu_'), date: Date.now(), supplier: supplier.trim(), note: note.trim(), by: App.user.id, status: 'received',
      lines: lines.map(l => ({ ingredientId: l.ingredientId, qty: round4(l.qty), total: roundTo(l.total, dec) })),
    };
    purchase.total = roundTo(purchase.lines.reduce((n, l) => n + l.total, 0), dec);
    if (!this.server) receivePurchase(purchase, id => this.ingredient(id));
    this.data.purchases.push(purchase);
    this.save();
    return purchase;
  },

  voidPurchase(purchase) {
    purchase.status = 'void';
    purchase.voidedAt = Date.now();
    purchase.voidedBy = App.user.id;
    if (!this.server) voidPurchase(purchase, id => this.ingredient(id));
    this.save();
  },

  // lines: [{ kind: 'ingredient' | 'product', refId, counted }]
  addStocktake({ note = '', lines }) {
    const st = { id: uid('st_'), date: Date.now(), by: App.user.id, note: note.trim(), lines: lines.map(l => ({ ...l })) };
    if (!this.server) st.value = applyStocktake(st, id => this.ingredient(id), id => this.product(id), decimalsOf(this.settings)).value;
    this.data.stocktakes.push(st);
    this.save();
    return st;
  },

  lowIngredients() {
    return this.data.ingredients.filter(i => i.active !== false && i.stock <= i.lowStock);
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

  // Turns a guest's request into items on the table's open order. Unavailable items are skipped.
  acceptGuestRequest(id, staffId) {
    const req = this.data.guestRequests.find(r => r.id === id);
    if (!req || req.status !== 'pending') return null;
    if (!this.table(req.tableId)) {
      this.resolveRequest(id, 'rejected', staffId);
      return { order: null, skipped: ['table no longer exists'] };
    }
    const existing = this.openOrderForTable(req.tableId);
    const order = existing || this.createOrder({ tableId: req.tableId, staffId });
    const skipped = [];
    for (const l of req.items) {
      const p = this.product(l.productId);
      if (!p || !p.active) { skipped.push(l.name); continue; }
      const qty = Math.min(l.qty, this.available(p));
      if (qty < l.qty) skipped.push(l.name);
      if (qty > 0) this.addItem(order, p, qty);
    }
    if (req.note) order.note = [order.note, 'Guest: ' + req.note].filter(Boolean).join(' / ');
    req.status = 'accepted';
    req.handledBy = staffId;
    req.handledAt = Date.now();
    if (!existing && !order.items.length) {
      this.removeOrder(order.id);
      return { order: null, skipped };
    }
    this.save();
    return { order, skipped };
  },

  resolveRequest(id, status, staffId) {
    const req = this.data.guestRequests.find(r => r.id === id);
    if (!req) return;
    req.status = status;
    req.handledBy = staffId;
    req.handledAt = Date.now();
    this.pruneRequests();
    this.save();
  },

  // Returns a promise in server mode (guests post to the server instead of writing data directly).
  addGuestRequest(req) {
    if (this.server) return Sync.guestRequest(req);
    this.data.guestRequests.push({ id: uid('g_'), status: 'pending', createdAt: Date.now(), ...req });
    this.pruneRequests();
    this.save();
    return Promise.resolve();
  },

  pruneRequests() {
    const handled = this.data.guestRequests.filter(r => r.status !== 'pending');
    if (handled.length <= 100) return;
    const drop = new Set(handled.slice(0, handled.length - 100).map(r => r.id));
    this.data.guestRequests = this.data.guestRequests.filter(r => !drop.has(r.id));
  },
};
