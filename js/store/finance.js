'use strict';

// Money records that are not bills: expenses, repeating expenses, the owner's cash moves and the daily close.
// In server mode the server checks and completes each record (server/rules/ledger.js); single-device mode applies the same
// rules here, so both behave alike. A closed day is locked: nothing can be added to it or voided in it.
const METHODS = ['cash', 'card', 'other'];

Object.assign(Store, {
  // ----- closed days -----
  isDayClosed(ts) {
    return this.data.dayCloses.some(c => c.id === Finance.dayKey(ts));
  },

  assertDayOpen(ts, what) {
    if (this.isDayClosed(ts)) throw new Error(`${Finance.dayKey(ts)} is already closed, so ${what}. Ask an admin to reopen that day, or record it for today.`);
  },

  // A positive amount, rounded to the money format.
  moneyField(value, what) {
    const n = roundTo(Number(value), decimalsOf(this.settings));
    if (!(n > 0) || n > 1e12) throw new Error(`Enter ${what}`);
    return n;
  },

  // The tax inside an amount (optional): never more than the amount.
  taxField(value, amount) {
    if (value === undefined || value === null || value === '') return 0;
    const t = roundTo(Number(value), decimalsOf(this.settings));
    if (!(t >= 0) || t > amount) throw new Error('The tax cannot be more than the amount');
    return t;
  },

  // The day a record belongs to: today by default, or an earlier day. Never in the future.
  recordDate(ts) {
    if (ts === undefined || ts === null || ts === '') return Date.now();
    if (Number(ts) >= Finance.dayBounds(Finance.dayKey(Date.now()))[1]) throw new Error('The date cannot be in the future');
    return Math.floor(Number(ts));
  },

  // ----- expenses -----
  addExpense({ date, category, description = '', amount, taxAmount = 0, method, payee = '', note = '' }) {
    amount = this.moneyField(amount, 'the amount');
    category = String(category || '').trim().slice(0, 30);
    if (!category) throw new Error('Choose a category');
    if (!METHODS.includes(method)) throw new Error('Choose how it was paid');
    date = this.recordDate(date);
    this.assertDayOpen(date, 'nothing can be added to it');
    const expense = {
      id: uid('ex_'), date, category, description: String(description).trim().slice(0, 120), amount, taxAmount: this.taxField(taxAmount, amount), method,
      payee: String(payee).trim().slice(0, 60), note: String(note).trim().slice(0, 300), status: 'active', by: App.user.id, createdAt: Date.now(),
    };
    this.data.expenses.push(expense);
    this.save();
    return expense;
  },

  voidExpense(expense) {
    this.assertDayOpen(expense.date, 'this expense cannot be voided');
    expense.status = 'void';
    expense.voidedAt = Date.now();
    expense.voidedBy = App.user.id;
    this.save();
  },

  // ----- expenses that repeat every month (rent, salaries) -----
  // template: { id?, category, description, amount, taxAmount, method (not cash), payee, day (1-28), startMonth 'YYYY-MM', active }
  saveRecurring(t) {
    const amount = this.moneyField(t.amount, 'the amount');
    const category = String(t.category || '').trim().slice(0, 30);
    if (!category) throw new Error('Choose a category');
    if (!METHODS.includes(t.method)) throw new Error('Choose how it is paid');
    if (t.method === 'cash') throw new Error('A repeating expense cannot be paid from the till. Choose bank, card or other.');
    const day = Math.floor(Number(t.day));
    if (!(day >= 1 && day <= 28)) throw new Error('Choose a day of the month between 1 and 28');
    const existing = t.id ? this.data.recurringExpenses.find(r => r.id === t.id) : null;
    const startMonth = existing ? existing.startMonth : (/^\d{4}-(0[1-9]|1[0-2])$/.test(t.startMonth || '') ? t.startMonth : Finance.monthKey(Date.now()));
    if (startMonth > Finance.monthKey(Date.now())) throw new Error('The first month cannot be in the future');
    const doc = {
      id: existing ? existing.id : uid('rc_'), category, description: String(t.description || '').trim().slice(0, 120), amount,
      taxAmount: this.taxField(t.taxAmount, amount), method: t.method, payee: String(t.payee || '').trim().slice(0, 60), day, startMonth, active: t.active !== false,
    };
    if (existing) Object.assign(existing, doc); else this.data.recurringExpenses.push(doc);
    this.runRecurring();
    this.save();
    return doc;
  },

  removeRecurring(id) {
    this.data.recurringExpenses = this.data.recurringExpenses.filter(r => r.id !== id);
    this.save();
  },

  // Single-device mode: writes the repeating expenses that have fallen due (the server does this itself in server mode).
  runRecurring() {
    if (this.server) return 0;
    const due = Finance.dueRecurring(this.data.recurringExpenses, this.data.expenses, Date.now(), key => this.data.dayCloses.some(c => c.id === key));
    this.data.expenses.push(...due);
    if (due.length) this.save();
    return due.length;
  },

  // ----- the owner putting money in or taking it out -----
  addOwnerMove({ date, type, amount, method, note = '' }) {
    if (type !== 'in' && type !== 'out') throw new Error('Choose whether money was put in or taken out');
    if (!METHODS.includes(method)) throw new Error('Choose cash, card or other');
    amount = this.moneyField(amount, 'the amount');
    date = this.recordDate(date);
    this.assertDayOpen(date, 'nothing can be added to it');
    const move = { id: uid('om_'), date, type, amount, method, note: String(note).trim().slice(0, 300), status: 'active', by: App.user.id, createdAt: Date.now() };
    this.data.ownerMoves.push(move);
    this.save();
    return move;
  },

  voidOwnerMove(move) {
    this.assertDayOpen(move.date, 'this record cannot be voided');
    move.status = 'void';
    move.voidedAt = Date.now();
    move.voidedBy = App.user.id;
    this.save();
  },

  // ----- the daily close -----
  // The server works out the summary itself; single-device mode works it out here with the same functions.
  closeDay(key, note = '') {
    if (this.isDayClosed(Finance.dayBounds(key)[0])) throw new Error('This day is already closed');
    if (this.data.shifts.some(s => !s.closedAt && Finance.dayKey(s.openedAt) === key)) throw new Error('A shift from that day is still open. Close the cash drawer first.');
    const doc = { id: key, date: key, note: String(note).trim().slice(0, 300), closedAt: Date.now(), closedBy: App.user.id };
    if (!this.server) {
      doc.summary = Finance.daySummary(key, this.data, this.settings);
      doc.summary.openBills = this.openOrders().length;
    }
    this.data.dayCloses.push(doc);
    this.save();
    return doc;
  },

  reopenDay(key) {
    this.data.dayCloses = this.data.dayCloses.filter(c => c.id !== key);
    this.save();
  },
});
