'use strict';

// Applies a batch of changes from one device. For each change: check the version the device last saw, run the rule for that
// collection (rules/*.js), save, write the audit entries, and then do the follow-up work other changes may need.
const { COLLECTIONS, refreshLacks } = require('../../js/shared.js');
const { Rejection, reject, isObj } = require('../base.js');
const { describe } = require('../audit.js');
const { docCache } = require('./helpers.js');
const { prepareSettings } = require('./settings.js');
const { prepareTable, prepareCategory, prepareProduct } = require('./catalog.js');
const { prepareUser } = require('./staff.js');
const { prepareOrder } = require('./orders.js');
const { prepareIngredient, preparePurchase, prepareStocktake } = require('./inventory.js');
const { prepareSupplier, prepareSupplierPayment } = require('./suppliers.js');
const { prepareCustomer } = require('./customers.js');
const { prepareCustomerPayment } = require('./receivables.js');
const { prepareShift } = require('./shifts.js');
const { prepareGuestRequest, prepareKitchenTicket, preparePrintJob } = require('./floor.js');
const ledger = require('./ledger.js');

// The rule for each collection. Every rule has the same shape: (db, ctx, id, prev, data, deleted, changed) and returns the
// document to store (or null to delete it), or throws a Rejection with a message fit to show the user.
//   ctx = { user, hasApproval(userId) }   prev = the stored document   changed = rows other than this one that the rule wrote
const RULES = {
  settings: prepareSettings,
  tables: prepareTable,
  categories: prepareCategory,
  products: prepareProduct,
  users: prepareUser,
  orders: prepareOrder,
  guestRequests: prepareGuestRequest,
  kitchenTickets: prepareKitchenTicket,
  printJobs: preparePrintJob,
  ingredients: prepareIngredient,
  customers: prepareCustomer,
  customerPayments: prepareCustomerPayment,
  suppliers: prepareSupplier,
  supplierPayments: prepareSupplierPayment,
  purchases: preparePurchase,
  stocktakes: prepareStocktake,
  shifts: prepareShift,
  expenses: ledger.prepareExpense,
  recurringExpenses: ledger.prepareRecurring,
  ownerMoves: ledger.prepareOwnerMove,
  dayCloses: ledger.prepareDayClose,
};

function prepare(db, ctx, col, id, prev, data, deleted, changed) {
  if (!deleted) {
    if (!isObj(data)) reject('Invalid data');
    if (col !== 'settings') data.id = id;
  }
  if (!Object.hasOwn(RULES, col)) reject('Unknown collection');
  return RULES[col](db, ctx, id, prev, data, deleted, changed);
}

// Applies a batch of changes from one device in a single transaction.
// Each change: { col, id, base (version the device last saw), data | deleted }.
function applyChanges(db, ctx, changes) {
  const changed = [];
  const results = db.tx(() => { const done = changes.map(ch => {
    const { col, id } = ch || {};
    const known = (col === 'settings' && id === 'main') || COLLECTIONS.includes(col);
    if (!known || typeof id !== 'string' || !id || id.length > 80) return { col, id, status: 'error', error: 'Invalid change', ver: 0, deleted: true, doc: null };
    const cur = db.get(col, id);
    const live = cur && !cur.deleted ? cur.data : null;
    const reply = (status, error) => ({ col, id, status, error, ver: cur ? cur.ver : 0, deleted: !live, doc: live });
    if ((ch.base || 0) !== (cur ? cur.ver : 0)) return reply('conflict');
    if (ch.deleted && !live) return reply('ok');
    try {
      const data = prepare(db, ctx, col, id, live, ch.deleted ? null : ch.data, !!ch.deleted, changed);
      const row = db.put(col, id, data, !!ch.deleted);
      changed.push(row);
      const nameOf = uid => (typeof uid === 'string' && (db.doc('users', uid) || {}).name) || null;
      for (const e of describe(col, live, ch.deleted ? null : data, !!ch.deleted, nameOf)) db.addAudit({ user: ctx.user, ...e });
      return { col, id, status: 'ok', ver: row.ver, deleted: row.deleted, doc: row.data };
    } catch (e) {
      if (e instanceof Rejection) return reply('error', e.message);
      throw e;
    }
  });
    // Ingredient stock moved (a sale, a purchase, a stocktake) or a recipe changed: update which dishes are short of something.
    if (changed.some(r => r.col === 'ingredients' || r.col === 'products')) refreshLacksDb(db, changed);
    // A new or changed repeating expense may already be due this month.
    if (changed.some(r => r.col === 'recurringExpenses')) ledger.runRecurring(db, changed);
    return done;
  });
  return { results, changed };
}

function refreshLacksDb(db, changed) {
  const ings = docCache(db, 'ingredients');
  for (const p of refreshLacks(db.all('products'), ings)) changed.push(db.put('products', p.id, p));
}

module.exports = { applyChanges, refreshLacksDb };
