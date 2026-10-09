'use strict';

// Rules for the money records that are not bills: expenses, repeating expenses, the owner's cash moves, and the daily
// close. A closed day is locked: nothing can be added to it or voided in it (an admin can reopen the day).
const { roundTo, decimalsOf } = require('../../js/shared.js');
const F = require('../../js/finance.js');
const { reject, need, isObj, cleanText } = require('../base.js');

const METHODS = ['cash', 'card', 'other'];
const KEY = /^\d{4}-\d{2}-\d{2}$/;

const dayClosed = (db, ts) => !!db.doc('dayCloses', F.dayKey(ts));
function needOpenDay(db, ts, what) {
  if (dayClosed(db, ts)) reject(`${F.dayKey(ts)} is already closed, so ${what}. Ask an admin to reopen that day, or record it for today.`);
}

// The day a record belongs to: today by default, or an earlier day chosen by the user. Never in the future.
function recordDate(v) {
  if (v === undefined || v === null || v === '') return Date.now();
  const t = Number(v);
  if (!Number.isFinite(t) || t < Date.now() - 800 * 86400000) reject('Check the date');
  if (t >= F.dayBounds(F.dayKey(Date.now()))[1]) reject('The date cannot be in the future');
  return Math.floor(t);
}

function money(v, dec, what) {
  const n = roundTo(Number(v), dec);
  if (!(n > 0) || n > 1e12) reject(`Enter ${what}`);
  return n;
}

function taxPart(v, amount, dec) {
  if (v === undefined || v === null || v === '') return 0;
  const t = roundTo(Number(v), dec);
  if (!(t >= 0) || t > amount) reject('The tax cannot be more than the amount');
  return t;
}

function prepareExpense(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'reports');
  if (deleted) reject('An expense cannot be deleted. Void it instead.');
  const dec = decimalsOf(db.doc('settings', 'main'));
  if (prev) {
    if (prev.status === 'void') reject('This expense is already void');
    if (data.status !== 'void') reject('An expense cannot be edited. Void it and enter it again.');
    need(ctx.user, 'manage');
    needOpenDay(db, prev.date, 'this expense cannot be voided');
    return { ...prev, status: 'void', voidedAt: Date.now(), voidedBy: ctx.user.id };
  }
  const amount = money(data.amount, dec, 'the amount');
  const category = cleanText(data.category, 30);
  if (!category) reject('Choose a category');
  if (!METHODS.includes(data.method)) reject('Choose how it was paid');
  const date = recordDate(data.date);
  needOpenDay(db, date, 'nothing can be added to it');
  return {
    id, date, category, description: cleanText(data.description, 120), amount, taxAmount: taxPart(data.taxAmount, amount, dec), method: data.method,
    payee: cleanText(data.payee, 60), note: cleanText(data.note, 300), status: 'active', by: ctx.user.id, createdAt: Date.now(),
  };
}

function prepareRecurring(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'reports');
  if (deleted) { need(ctx.user, 'manage'); return null; }
  const dec = decimalsOf(db.doc('settings', 'main'));
  const amount = money(data.amount, dec, 'the amount');
  const category = cleanText(data.category, 30);
  if (!category) reject('Choose a category');
  if (!METHODS.includes(data.method)) reject('Choose how it is paid');
  if (data.method === 'cash') reject('A repeating expense cannot be paid from the till. Choose bank, card or other.');
  const day = Math.floor(Number(data.day));
  if (!(day >= 1 && day <= 28)) reject('Choose a day of the month between 1 and 28');
  const startMonth = prev ? prev.startMonth : (typeof data.startMonth === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(data.startMonth) ? data.startMonth : F.monthKey(Date.now()));
  if (startMonth > F.monthKey(Date.now())) reject('The first month cannot be in the future');
  if (startMonth < F.monthKey(Date.now() - 800 * 86400000)) reject('The first month is too long ago');
  return {
    id, category, description: cleanText(data.description, 120), amount, taxAmount: taxPart(data.taxAmount, amount, dec), method: data.method,
    payee: cleanText(data.payee, 60), day, startMonth, active: data.active !== false,
  };
}

// Writes the expenses that are due (one per template per month; see Finance.dueRecurring). `changed` collects the rows.
function runRecurring(db, changed, now = Date.now()) {
  const templates = db.all('recurringExpenses');
  if (!templates.length) return 0;
  const existing = db.where('expenses', "json_extract(data, '$.recurringId') IS NOT NULL").map(r => ({ id: r.id }));
  const due = F.dueRecurring(templates, existing, now, key => !!db.doc('dayCloses', key));
  for (const e of due) changed.push(db.put('expenses', e.id, e));
  return due.length;
}

function prepareOwnerMove(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'reports');
  if (deleted) reject('This record cannot be deleted. Void it instead.');
  const dec = decimalsOf(db.doc('settings', 'main'));
  if (prev) {
    if (prev.status === 'void') reject('This record is already void');
    if (data.status !== 'void') reject('This record cannot be edited. Void it and enter it again.');
    need(ctx.user, 'manage');
    needOpenDay(db, prev.date, 'this record cannot be voided');
    return { ...prev, status: 'void', voidedAt: Date.now(), voidedBy: ctx.user.id };
  }
  if (data.type !== 'in' && data.type !== 'out') reject('Choose whether money was put in or taken out');
  if (!METHODS.includes(data.method)) reject('Choose cash, card or other');
  const amount = money(data.amount, dec, 'the amount');
  const date = recordDate(data.date);
  needOpenDay(db, date, 'nothing can be added to it');
  return { id, date, type: data.type, amount, method: data.method, note: cleanText(data.note, 300), status: 'active', by: ctx.user.id, createdAt: Date.now() };
}

// Everything the statements need for one day, read from the database.
function ledgerData(db, a, b) {
  const between = (col, field) => db.where(col, `json_extract(data, '$.${field}') >= ? AND json_extract(data, '$.${field}') < ?`, a, b).map(r => r.data);
  return {
    orders: db.where('orders', "(json_extract(data, '$.paidAt') >= ? AND json_extract(data, '$.paidAt') < ?) OR (json_extract(data, '$.refundedAt') >= ? AND json_extract(data, '$.refundedAt') < ?) OR (json_extract(data, '$.voidedAt') >= ? AND json_extract(data, '$.voidedAt') < ?)", a, b, a, b, a, b).map(r => r.data),
    purchases: between('purchases', 'date'), supplierPayments: between('supplierPayments', 'date'), stocktakes: between('stocktakes', 'date'),
    expenses: between('expenses', 'date'), ownerMoves: between('ownerMoves', 'date'), customerPayments: between('customerPayments', 'date'), shifts: between('shifts', 'openedAt'),
  };
}

function prepareDayClose(db, ctx, id, prev, data, deleted) {
  if (deleted) {
    need(ctx.user, 'settings');   // reopening a closed day is an admin's decision
    return null;
  }
  need(ctx.user, 'reports');
  if (prev) reject('This day is already closed');
  if (!KEY.test(id)) reject('Invalid day');
  const [a, b] = F.dayBounds(id);
  if (F.dayKey(a) !== id) reject('Invalid day');
  if (a >= F.dayBounds(F.dayKey(Date.now()))[1]) reject('A day in the future cannot be closed');
  if (db.where('shifts', "json_extract(data, '$.openedAt') >= ? AND json_extract(data, '$.openedAt') < ? AND json_extract(data, '$.closedAt') IS NULL", a, b).length) {
    reject('A shift from that day is still open. Close the cash drawer first.');
  }
  const settings = db.doc('settings', 'main');
  const summary = F.daySummary(id, ledgerData(db, a, b), settings);
  summary.openBills = db.where('orders', "json_extract(data, '$.status') = 'open'").length;
  return { id, date: id, closedAt: Date.now(), closedBy: ctx.user.id, note: cleanText(isObj(data) ? data.note : '', 300), summary };
}

module.exports = { taxPart, prepareExpense, prepareRecurring, prepareOwnerMove, prepareDayClose, runRecurring, needOpenDay, dayClosed, ledgerData };
