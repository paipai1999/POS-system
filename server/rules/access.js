'use strict';

// Who may see which records: what a device is sent depends on the signed-in person.
const { can } = require('../base.js');

function stripUser(u) {
  if (!u) return u;
  const { pin, pinHash, ...rest } = u;
  return rest;
}

// Rows leave the server without PINs.
function publicRow(row) {
  return row.col === 'users' && row.data ? { ...row, data: stripUser(row.data) } : row;
}

// Cashiers, managers and admins see every order. Waiters see open orders (they need the table map)
// and the orders they took themselves, but not other people's takings.
function canSeeOrder(user, order) {
  if (can(user, 'checkout') || can(user, 'reports')) return true;
  return order.status === 'open' || order.staffId === user.id;
}

// The kitchen display only needs the tickets (they carry the order number and table name), staff names and settings.
const KITCHEN_ONLY = new Set(['settings', 'users', 'kitchenTickets']);

const isKitchenOnly = user => !can(user, 'tables') && !can(user, 'checkout') && !can(user, 'orders') && !can(user, 'products');

// Costs and purchases are for managers; customer details are for whoever takes payments.
const COST_COLS = new Set(['ingredients', 'purchases', 'stocktakes', 'suppliers']);

// Expenses, repeating expenses, the owner's money moves and the daily closes are for managers (the 'reports' permission).
const FINANCE_COLS = new Set(['expenses', 'recurringExpenses', 'ownerMoves', 'dayCloses']);

// A line's cost and the ingredients used (written at payment) show how much a dish costs: managers only.
function withoutCosts(order) {
  return { ...order, items: order.items.map(({ cost, used, ...line }) => line) };
}

// Removes what `user` may not see. With `tombstone`, an order that is no longer visible (e.g. a colleague's
// table that was just paid) is sent as a deletion so the device drops its stale copy instead of showing it open forever.
function rowsFor(user, rows, { tombstone = false } = {}) {
  if (!user) return [];
  if (isKitchenOnly(user)) rows = rows.filter(r => KITCHEN_ONLY.has(r.col));
  const out = [];
  for (const row of rows) {
    if (row.col === 'shifts' && !(can(user, 'checkout') || can(user, 'reports'))) continue;
    if (row.col === 'purchases' && !can(user, 'products')) {
      // The till needs to know about cash spent on a purchase, nothing else about it.
      const d = row.data;
      if (d && d.payMethod === 'cash' && (can(user, 'checkout') || can(user, 'reports'))) out.push({ ...row, data: { id: d.id, date: d.date, paid: d.paid, payMethod: 'cash', status: d.status } });
      continue;
    }
    if (FINANCE_COLS.has(row.col) && !can(user, 'reports')) {
      const d = row.data;
      if ((row.col === 'expenses' || row.col === 'ownerMoves') && d && d.method === 'cash' && can(user, 'checkout')) {
        out.push({ ...row, data: { id: d.id, date: d.date, amount: d.amount, method: 'cash', status: d.status, ...(d.type ? { type: d.type } : {}) } });
      }
      continue;
    }
    if (COST_COLS.has(row.col) && !can(user, 'products')) continue;
    if (row.col === 'supplierPayments' && !can(user, 'products')) {
      // Whoever runs the till needs to know about cash that left it, but not who it was paid to or why.
      const d = row.data;
      if (d && d.method === 'cash' && (can(user, 'checkout') || can(user, 'reports'))) out.push({ ...row, data: { id: d.id, date: d.date, amount: d.amount, method: 'cash', status: d.status } });
      continue;
    }
    if (row.col === 'products' && row.data && row.data.recipe && !can(user, 'products')) {
      const { recipe, ...product } = row.data; // recipes show what a dish costs to make: managers only
      out.push({ ...row, data: product });
      continue;
    }
    if ((row.col === 'customers' || row.col === 'customerPayments') && !(can(user, 'checkout') || can(user, 'products'))) continue;
    if (row.col !== 'orders' || row.deleted || !row.data) out.push(row);
    else if (canSeeOrder(user, row.data)) out.push(can(user, 'products') ? row : { ...row, data: withoutCosts(row.data) });
    else if (tombstone) out.push({ ...row, deleted: true, data: null });
  }
  return out;
}

module.exports = { stripUser, publicRow, rowsFor };
