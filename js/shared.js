'use strict';

// Code shared by the browser app and the Node server (roles, ids, demo data, dataset checks).
(function (root) {
  // 'manage' covers manager-only actions: voids, refunds, discounts, removing items already sent to the kitchen.
  const ROLES = {
    admin:   { label: 'Admin',   perms: ['tables', 'checkout', 'orders', 'manage', 'products', 'reports', 'users', 'settings', 'guest', 'kitchen'] },
    manager: { label: 'Manager', perms: ['tables', 'checkout', 'orders', 'manage', 'products', 'reports', 'guest', 'kitchen'] },
    cashier: { label: 'Cashier', perms: ['tables', 'checkout', 'orders', 'guest'] },
    waiter:  { label: 'Waiter',  perms: ['tables', 'orders', 'guest'] },
    kitchen: { label: 'Kitchen', perms: ['kitchen'] },
  };

  const ROLE_INFO = {
    admin: 'Full access, including staff accounts and settings',
    manager: 'Menu, stock, reports, refunds, voids and discounts',
    cashier: 'Take orders and payments',
    waiter: 'Tables, orders and guest requests (no payments)',
    kitchen: 'Kitchen display only',
  };

  // Every synced collection except settings, which is a single document.
  const COLLECTIONS = ['users', 'categories', 'products', 'tables', 'orders', 'guestRequests', 'kitchenTickets', 'printJobs', 'shifts', 'ingredients', 'customers', 'purchases', 'stocktakes'];

  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  // Quantities (grams, millilitres) and unit costs are kept to 4 decimals so repeated additions stay exact.
  function round4(n) {
    return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
  }

  // Money is shown and rounded to 2 decimals (dollars, euros…) or 0 (kyat, yen…), chosen in Settings.
  function decimalsOf(settings) {
    return settings && settings.decimals === 0 ? 0 : 2;
  }

  function roundTo(n, decimals) {
    const f = decimals === 0 ? 1 : 100;
    return Math.round((Number(n) + Number.EPSILON) * f) / f;
  }

  // The one place order totals are calculated: the browser shows them and the server re-checks them at payment.
  function computeTotals(order, settings) {
    const r = n => roundTo(n, decimalsOf(settings));
    const subtotal = r(order.items.reduce((sum, l) => sum + l.price * l.qty, 0));
    let discount = 0;
    if (order.discount && order.discount.value > 0) {
      discount = order.discount.type === 'percent' ? subtotal * order.discount.value / 100 : order.discount.value;
    }
    discount = r(Math.min(discount, subtotal));
    const afterDiscount = subtotal - discount;
    // Loyalty points the customer spends (1 point = 1 unit of money) come off before service charge and tax.
    const points = r(Math.min(Math.max(0, Number(order.pointsUsed) || 0), afterDiscount));
    const net = afterDiscount - points;
    const serviceRate = Number(settings.serviceRate) || 0;
    const taxRate = Number(settings.taxRate) || 0;
    const service = r(net * serviceRate / 100);
    const tax = r((net + service) * taxRate / 100);
    const total = r(net + service + tax);
    return { subtotal, discount, ...(points ? { points } : {}), serviceRate, service, taxRate, tax, total };
  }

  // ----- ingredients and recipes -----
  // A menu item can have a recipe: [{ ingredientId, qty }] = how much of each ingredient one portion uses.
  // Paying a bill uses up the ingredients (and remembers what was used and what it cost, so a refund puts back exactly that);
  // ingredient stock may go below zero, because the food was served anyway and a stocktake sets it right again.
  const recipeOf = product => (product && Array.isArray(product.recipe) ? product.recipe : []);

  // Cost of one portion at today's ingredient costs; null when the item has no recipe.
  function recipeCost(product, getIngredient) {
    const recipe = recipeOf(product);
    if (!recipe.length) return null;
    return round4(recipe.reduce((n, r) => n + r.qty * ((getIngredient(r.ingredientId) || {}).cost || 0), 0));
  }

  // Returns the ingredients that changed.
  function consumeIngredients(items, getProduct, getIngredient) {
    const changed = new Set();
    for (const l of items) {
      const recipe = recipeOf(getProduct(l.productId));
      delete l.used;
      delete l.cost;
      if (!recipe.length) continue;
      const used = [];
      let unitCost = 0;
      for (const r of recipe) {
        const ing = getIngredient(r.ingredientId);
        if (!ing) continue;
        const qty = round4(r.qty * l.qty);
        ing.stock = round4((ing.stock || 0) - qty);
        used.push({ ingredientId: ing.id, qty });
        unitCost += r.qty * (ing.cost || 0);
        changed.add(ing);
      }
      l.used = used;
      l.cost = round4(unitCost);
    }
    return [...changed];
  }

  function restoreIngredients(items, getIngredient) {
    const changed = new Set();
    for (const l of items) {
      for (const u of l.used || []) {
        const ing = getIngredient(u.ingredientId);
        if (!ing) continue;
        ing.stock = round4((ing.stock || 0) + u.qty);
        changed.add(ing);
      }
    }
    return [...changed];
  }

  // ----- purchases (stock coming in) and stocktakes (stock counted) -----
  // A purchase line is { ingredientId, qty, total } (total = what was paid for that quantity). Receiving it adds the stock and
  // moves the ingredient's cost to the weighted average of what was in stock and what was bought.
  function receivePurchase(purchase, getIngredient) {
    const changed = new Set();
    for (const l of purchase.lines) {
      const ing = getIngredient(l.ingredientId);
      if (!ing) continue;
      const unitCost = l.qty > 0 ? l.total / l.qty : 0;
      const had = Math.max(ing.stock || 0, 0);
      ing.cost = had + l.qty > 0 ? round4((had * (ing.cost || 0) + l.qty * unitCost) / (had + l.qty)) : round4(unitCost);
      ing.stock = round4((ing.stock || 0) + l.qty);
      l.name = ing.name;
      l.unit = ing.unit;
      l.unitCost = round4(unitCost);
      changed.add(ing);
    }
    return [...changed];
  }

  // Voiding a purchase takes the stock back out; the average cost is left as it is.
  function voidPurchase(purchase, getIngredient) {
    const changed = new Set();
    for (const l of purchase.lines) {
      const ing = getIngredient(l.ingredientId);
      if (!ing) continue;
      ing.stock = round4((ing.stock || 0) - l.qty);
      changed.add(ing);
    }
    return [...changed];
  }

  // A stocktake line is { kind: 'ingredient' | 'product', refId, counted }. Fills in what was expected, the difference and its
  // value, and sets the stock to the counted figure. Returns { changed, value } (value is negative for a loss).
  function applyStocktake(stocktake, getIngredient, getProduct, decimals = 2) {
    const changed = new Set();
    let value = 0;
    for (const l of stocktake.lines) {
      const target = l.kind === 'product' ? getProduct(l.refId) : getIngredient(l.refId);
      if (!target) continue;
      const unitCost = l.kind === 'product' ? 0 : target.cost || 0;
      l.name = target.name;
      l.unit = l.kind === 'product' ? 'pcs' : target.unit;
      l.expected = round4(target.stock || 0);
      l.counted = round4(l.counted);
      l.diff = round4(l.counted - l.expected);
      l.value = roundTo(l.diff * unitCost, decimals);
      value += l.diff * unitCost;
      target.stock = l.counted;
      changed.add(target);
    }
    return { changed: [...changed], value: roundTo(value, decimals) };
  }

  // ----- customers and loyalty points -----
  // With loyalty on, a paid bill earns `earnPercent` % of the total as points (1 point = 1 unit of money, kept to the
  // currency's decimals), and a customer may pay part of a bill with points (at most `maxRedeemPercent` % of it).
  function loyaltyOf(settings) {
    const l = (settings && settings.loyalty) || {};
    return { enabled: !!l.enabled, earnPercent: Number(l.earnPercent) || 0, maxRedeemPercent: l.maxRedeemPercent === undefined ? 50 : Number(l.maxRedeemPercent) || 0 };
  }

  function floorTo(n, decimals) {
    const f = decimals === 0 ? 1 : 100;
    return Math.floor((Number(n) + 1e-9) * f) / f;
  }

  function loyaltyEarn(total, settings) {
    const l = loyaltyOf(settings);
    return l.enabled ? floorTo(total * l.earnPercent / 100, decimalsOf(settings)) : 0;
  }

  // The most points a bill can take: a share of the bill after discount, never more than the customer has.
  function maxRedeemable(order, customer, settings) {
    const l = loyaltyOf(settings);
    if (!l.enabled || !customer) return 0;
    const t = computeTotals({ ...order, pointsUsed: 0 }, settings);
    const room = floorTo((t.subtotal - t.discount) * l.maxRedeemPercent / 100, decimalsOf(settings));
    return Math.max(0, Math.min(room, floorTo(customer.points || 0, decimalsOf(settings))));
  }

  // At payment: points spent leave the balance, points earned join it, and the visit is counted.
  function applyLoyalty(order, customer, settings, now = Date.now()) {
    const dec = decimalsOf(settings);
    const used = order.totals && order.totals.points ? order.totals.points : 0;
    const earned = loyaltyEarn(order.totals.total, settings);
    customer.points = roundTo((customer.points || 0) - used + earned, dec);
    customer.spent = roundTo((customer.spent || 0) + order.totals.total, dec);
    customer.visits = (customer.visits || 0) + 1;
    customer.lastVisit = now;
    order.loyalty = { customerId: customer.id, earned, used, balance: customer.points };
  }

  function reverseLoyalty(order, customer, settings) {
    const dec = decimalsOf(settings);
    const { earned = 0, used = 0 } = order.loyalty || {};
    customer.points = Math.max(0, roundTo((customer.points || 0) - earned + used, dec));
    customer.spent = Math.max(0, roundTo((customer.spent || 0) - (order.totals ? order.totals.total : 0), dec));
    customer.visits = Math.max(0, (customer.visits || 0) - 1);
  }

  // ----- stock -----
  // Stock is taken once, at payment, and a refund returns exactly what was taken. Used by both the browser (single-device
  // mode) and the server, so the two cannot drift apart. `getProduct(id)` returns the product object to change (or null).
  // Returns the products that changed.
  function takeStockLines(items, getProduct) {
    const changed = new Set();
    for (const l of items) {
      const p = getProduct(l.productId);
      if (!p || !p.trackStock) continue;
      l.stockTaken = Math.min(p.stock, l.qty);
      p.stock -= l.stockTaken;
      changed.add(p);
    }
    return [...changed];
  }

  function returnStockLines(items, getProduct) {
    const changed = new Set();
    for (const l of items) {
      const p = getProduct(l.productId);
      if (!p || !p.trackStock) continue;
      p.stock += l.stockTaken ?? l.qty;
      changed.add(p);
    }
    return [...changed];
  }

  // ----- payments -----
  // A payment is { method: 'cash'|'card'|'other'|'split', amount (the bill), tip, tendered/change (cash), parts[] (split) }.
  // What the customer handed over in total is amount + tip.
  const PAY_METHODS = ['cash', 'card', 'other'];

  // How much of a payment went through each method (tips included): { cash: 12, card: 8 }.
  function paymentByMethod(payment) {
    if (!payment) return {};
    if (payment.method === 'split' && Array.isArray(payment.parts)) {
      const out = {};
      for (const part of payment.parts) out[part.method] = (out[part.method] || 0) + Number(part.amount || 0);
      return out;
    }
    return { [payment.method]: Number(payment.amount || 0) + Number(payment.tip || 0) };
  }

  // Cash that stayed in the till for this payment (what was handed over minus the change given back).
  function paymentCash(payment) {
    return paymentByMethod(payment).cash || 0;
  }

  // Checks a payment against the bill and returns the figures to store: { totals, payment }.
  // Throws an Error with a message fit to show the cashier. The server and the browser both use this.
  function settleOrder(order, payment, settings) {
    const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const dec = decimalsOf(settings);
    const t = computeTotals(order, settings);
    const pay = isObj(payment) ? payment : {};
    const tip = pay.tip === undefined || pay.tip === null || pay.tip === '' ? 0 : roundTo(Number(pay.tip), dec);
    if (!(tip >= 0) || tip > Math.max(t.total * 10, 1000)) throw new Error('Invalid tip');
    const due = roundTo(t.total + tip, dec); // the bill plus the tip is what the customer hands over
    const out = { method: pay.method, amount: t.total };
    if (tip) out.tip = tip;
    if (pay.method === 'cash') {
      const tendered = roundTo(Number(pay.tendered), dec);
      if (!(tendered >= due)) throw new Error('Cash received is less than the total');
      out.tendered = tendered;
      out.change = roundTo(tendered - due, dec);
    } else if (pay.method === 'split') {
      const parts = Array.isArray(pay.parts) ? pay.parts : [];
      if (parts.length < 2 || parts.length > PAY_METHODS.length) throw new Error('A split payment needs two or three parts');
      const seen = new Set();
      let sum = 0;
      out.parts = parts.map(p => {
        if (!isObj(p) || !PAY_METHODS.includes(p.method) || seen.has(p.method)) throw new Error('Invalid payment method');
        seen.add(p.method);
        const amount = roundTo(Number(p.amount), dec);
        if (!(amount > 0)) throw new Error('Invalid split amount');
        sum += amount;
        const part = { method: p.method, amount };
        if (p.method === 'cash') {
          const tendered = roundTo(Number(p.tendered ?? amount), dec);
          if (!(tendered >= amount)) throw new Error('Cash received is less than the total');
          part.tendered = tendered;
          part.change = roundTo(tendered - amount, dec);
        }
        return part;
      });
      if (Math.abs(roundTo(sum, dec) - due) > 0.005) throw new Error('The parts of a split payment must add up to the total');
    } else if (!PAY_METHODS.includes(pay.method)) {
      throw new Error('Invalid payment method');
    }
    return { totals: t, payment: out };
  }

  // The cash drawer for one shift: opening float + cash taken − cash paid back out in refunds.
  function computeShift(shift, orders, decimals = 2) {
    const from = shift.openedAt, to = shift.closedAt || Infinity;
    let cashIn = 0, cashOut = 0, tips = 0, sales = 0, count = 0;
    for (const o of orders) {
      if ((o.status === 'paid' || o.status === 'refunded') && o.paidAt >= from && o.paidAt <= to) {
        cashIn += paymentCash(o.payment);
        tips += Number(o.payment && o.payment.tip || 0);
        sales += Number(o.totals && o.totals.total || 0);
        count++;
      }
      if (o.status === 'refunded' && o.refundedAt >= from && o.refundedAt <= to) cashOut += paymentCash(o.payment);
    }
    const r = n => roundTo(n, decimals);
    const expected = r(Number(shift.openingFloat || 0) + cashIn - cashOut);
    return { cashIn: r(cashIn), cashOut: r(cashOut), tips: r(tips), sales: r(sales), orders: count, expected };
  }

  // The price of a line = menu price + the options picked (kept to the cent; the bill rounds as a whole).
  function lineUnitPrice(product, mods) {
    return roundTo(Number(product.price) + (mods || []).reduce((n, m) => n + Number(m.price || 0), 0), 2);
  }

  // Unguessable code printed in each table's QR link.
  function guestCode() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = new Uint8Array(10);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => chars[b % chars.length]).join('');
  }

  function seedData() {
    const cats = ['Coffee', 'Tea', 'Breakfast', 'Mains', 'Desserts', 'Cold Drinks'].map((name, i) => ({ id: uid('c_'), name, sort: i }));
    const catId = Object.fromEntries(cats.map(c => [c.name, c.id]));
    const ings = [
      ['Coffee beans', 'g', 5000, 500, 0.04],
      ['Milk', 'ml', 20000, 3000, 0.0012],
      ['Tea leaves', 'g', 1000, 100, 0.05],
    ].map(([name, unit, stock, lowStock, cost]) => ({ id: uid('i_'), name, unit, stock, lowStock, cost, active: true }));
    const ingId = Object.fromEntries(ings.map(i => [i.name, i.id]));
    const p = (name, cat, price, emoji, description, stock = null, recipe = []) => ({
      id: uid('p_'), name, categoryId: catId[cat], price, emoji, description,
      trackStock: stock !== null, stock: stock ?? 0, lowStock: 5, active: true,
      recipe: recipe.map(([ing, qty]) => ({ ingredientId: ingId[ing], qty })),
    });
    return {
      version: 1,
      settings: {
        name: 'My Cafe',
        address: '123 Main Street',
        phone: '',
        currency: '$',
        decimals: 2,
        currencyAfter: false,
        taxRate: 7,
        serviceRate: 0,
        receiptFooter: 'Thank you! Please come again.',
        printKitchenTickets: true,
        nextOrderNo: 1,
        loyalty: { enabled: false, earnPercent: 5, maxRedeemPercent: 50 },
      },
      users: [
        { id: uid('u_'), name: 'Admin', role: 'admin', pin: '1234', active: true },
        { id: uid('u_'), name: 'Maya', role: 'cashier', pin: '1111', active: true },
        { id: uid('u_'), name: 'Leo', role: 'waiter', pin: '2222', active: true },
        { id: uid('u_'), name: 'Kitchen', role: 'kitchen', pin: '3333', active: true },
      ],
      categories: cats,
      products: [
        p('Espresso', 'Coffee', 2.5, '☕', 'Double shot, rich and bold', null, [['Coffee beans', 18]]),
        p('Cappuccino', 'Coffee', 3.8, '☕', 'Espresso with steamed milk foam', null, [['Coffee beans', 18], ['Milk', 120]]),
        p('Latte', 'Coffee', 4.0, '🥛', 'Smooth espresso with plenty of milk', null, [['Coffee beans', 18], ['Milk', 220]]),
        p('Iced Americano', 'Coffee', 3.5, '🧊', 'Espresso over ice and water', null, [['Coffee beans', 18]]),
        p('Green Tea', 'Tea', 2.8, '🍵', 'Japanese sencha', null, [['Tea leaves', 3]]),
        p('Chai Latte', 'Tea', 3.9, '🫖', 'Spiced black tea with milk', null, [['Tea leaves', 4], ['Milk', 200]]),
        p('Avocado Toast', 'Breakfast', 8.5, '🥑', 'Sourdough, smashed avocado, chilli flakes', 20),
        p('Pancake Stack', 'Breakfast', 9.0, '🥞', 'Maple syrup, berries and butter', 15),
        p('Club Sandwich', 'Mains', 11.5, '🥪', 'Chicken, bacon, lettuce and tomato', 15),
        p('Chicken Burger', 'Mains', 12.9, '🍔', 'Crispy chicken, slaw and fries', 12),
        p('Pasta Pomodoro', 'Mains', 11.0, '🍝', 'Tomato, basil and parmesan'),
        p('Cheesecake', 'Desserts', 5.5, '🍰', 'New York style', 8),
        p('Chocolate Brownie', 'Desserts', 4.5, '🍫', 'Served warm with vanilla ice cream', 10),
        p('Fresh Orange Juice', 'Cold Drinks', 4.2, '🍊', 'Squeezed to order'),
        p('Lemonade', 'Cold Drinks', 3.5, '🍋', 'House-made, lightly sweet'),
        p('Sparkling Water', 'Cold Drinks', 2.0, '💧', '330 ml bottle', 40),
      ],
      tables: Array.from({ length: 10 }, (_, i) => ({ id: uid('t_'), name: 'Table ' + (i + 1), guestCode: guestCode() })),
      orders: [],
      guestRequests: [],
      kitchenTickets: [],
      printJobs: [],
      shifts: [],
      ingredients: ings,
      customers: [],
      purchases: [],
      stocktakes: [],
    };
  }

  function isValidDataset(d) {
    return !!d && d.version === 1 && !!d.settings && typeof d.settings === 'object' &&
      ['users', 'categories', 'products', 'tables', 'orders'].every(k => Array.isArray(d[k])) &&
      d.users.some(u => u && u.role === 'admin' && u.active);
  }

  // Brings data saved by older versions up to date.
  function normalizeDataset(d) {
    for (const col of COLLECTIONS) if (!Array.isArray(d[col])) d[col] = [];
    d.categories.forEach((c, i) => { if (typeof c.sort !== 'number') c.sort = i; });
    d.tables.forEach(t => { if (!t.guestCode) t.guestCode = guestCode(); });
    return d;
  }

  const api = { ROLES, ROLE_INFO, COLLECTIONS, uid, round2, round4, roundTo, decimalsOf, computeTotals, recipeOf, recipeCost, consumeIngredients, restoreIngredients, receivePurchase, voidPurchase, applyStocktake, loyaltyOf, loyaltyEarn, maxRedeemable, applyLoyalty, reverseLoyalty, floorTo, PAY_METHODS, paymentByMethod, paymentCash, computeShift, lineUnitPrice, settleOrder, takeStockLines, returnStockLines, guestCode, seedData, isValidDataset, normalizeDataset };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
