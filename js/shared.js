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
  const COLLECTIONS = ['users', 'categories', 'products', 'tables', 'orders', 'guestRequests', 'kitchenTickets', 'printJobs'];

  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  // The one place order totals are calculated: the browser shows them and the server re-checks them at payment.
  function computeTotals(order, settings) {
    const subtotal = round2(order.items.reduce((sum, l) => sum + l.price * l.qty, 0));
    let discount = 0;
    if (order.discount && order.discount.value > 0) {
      discount = order.discount.type === 'percent' ? subtotal * order.discount.value / 100 : order.discount.value;
    }
    discount = round2(Math.min(discount, subtotal));
    const afterDiscount = subtotal - discount;
    const serviceRate = Number(settings.serviceRate) || 0;
    const taxRate = Number(settings.taxRate) || 0;
    const service = round2(afterDiscount * serviceRate / 100);
    const tax = round2((afterDiscount + service) * taxRate / 100);
    const total = round2(afterDiscount + service + tax);
    return { subtotal, discount, serviceRate, service, taxRate, tax, total };
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
    const p = (name, cat, price, emoji, description, stock = null) => ({
      id: uid('p_'), name, categoryId: catId[cat], price, emoji, description,
      trackStock: stock !== null, stock: stock ?? 0, lowStock: 5, active: true,
    });
    return {
      version: 1,
      settings: {
        name: 'My Cafe',
        address: '123 Main Street',
        phone: '',
        currency: '$',
        taxRate: 7,
        serviceRate: 0,
        receiptFooter: 'Thank you! Please come again.',
        printKitchenTickets: true,
        nextOrderNo: 1,
      },
      users: [
        { id: uid('u_'), name: 'Admin', role: 'admin', pin: '1234', active: true },
        { id: uid('u_'), name: 'Maya', role: 'cashier', pin: '1111', active: true },
        { id: uid('u_'), name: 'Leo', role: 'waiter', pin: '2222', active: true },
        { id: uid('u_'), name: 'Kitchen', role: 'kitchen', pin: '3333', active: true },
      ],
      categories: cats,
      products: [
        p('Espresso', 'Coffee', 2.5, '☕', 'Double shot, rich and bold'),
        p('Cappuccino', 'Coffee', 3.8, '☕', 'Espresso with steamed milk foam'),
        p('Latte', 'Coffee', 4.0, '🥛', 'Smooth espresso with plenty of milk'),
        p('Iced Americano', 'Coffee', 3.5, '🧊', 'Espresso over ice and water'),
        p('Green Tea', 'Tea', 2.8, '🍵', 'Japanese sencha'),
        p('Chai Latte', 'Tea', 3.9, '🫖', 'Spiced black tea with milk'),
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

  const api = { ROLES, ROLE_INFO, COLLECTIONS, uid, round2, computeTotals, guestCode, seedData, isValidDataset, normalizeDataset };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
