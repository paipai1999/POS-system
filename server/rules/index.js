'use strict';

// The server's business rules, gathered in one place (the HTTP layer in server.js only uses what is exported here).
//   access.js     who may see which records
//   apply.js      applying a batch of changes from a device (version checks, the rule per collection, audit)
//   settings.js, catalog.js, staff.js, customers.js            settings, menu and tables, staff, customers
//   orders.js, shifts.js, floor.js                              bills, cash drawer, guest requests / kitchen tickets / print jobs
//   inventory.js, suppliers.js                                  ingredients, purchases, stocktakes, suppliers
//   ledger.js     expenses, repeating expenses, the owner's cash moves, the daily close
//   guest.js      what a guest at a table sees and sends
//   helpers.js    small helpers shared by the files above
const { Rejection, can } = require('../base.js');
const { applyChanges, refreshLacksDb } = require('./apply.js');
const { rowsFor, publicRow, stripUser } = require('./access.js');
const { guestState, createGuestRequest, tableByCode } = require('./guest.js');
const { splitOrder } = require('./orders.js');
const ledger = require('./ledger.js');

// Writes the repeating expenses that have fallen due; returns the new rows so the caller can tell the connected devices.
function runRecurringDb(db) {
  const rows = [];
  db.tx(() => ledger.runRecurring(db, rows));
  return rows;
}

module.exports = { applyChanges, refreshLacksDb, runRecurringDb, guestState, createGuestRequest, tableByCode, splitOrder, rowsFor, publicRow, stripUser, can, Rejection };
