'use strict';

// Basic building blocks: roles, the list of synced collections, ids, rounding and money formats.
// Used by both the browser app (loaded as a script, see index.html) and the Node server (through js/shared.js).
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
  // The order matters: a device sends its changes in this order, so a new ingredient, supplier or customer arrives
  // before the recipe, purchase or bill that refers to it.
  const COLLECTIONS = ['users', 'categories', 'ingredients', 'suppliers', 'customers', 'products', 'tables', 'orders', 'guestRequests', 'kitchenTickets', 'printJobs', 'shifts', 'purchases', 'stocktakes', 'supplierPayments', 'expenses', 'recurringExpenses', 'ownerMoves', 'dayCloses', 'customerPayments'];

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

  // Unguessable code printed in each table's QR link.
  function guestCode() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = new Uint8Array(10);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => chars[b % chars.length]).join('');
  }

  const api = { ROLES, ROLE_INFO, COLLECTIONS, uid, round2, round4, decimalsOf, roundTo, guestCode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
