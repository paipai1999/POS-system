'use strict';

// The cash drawer: starting and closing a shift.
Object.assign(Store, {
  // ----- cash drawer -----
  openShift() { return this.data.shifts.find(s => !s.closedAt) || null; },

  startShift(openingFloat) {
    const shift = { id: uid('s_'), openingFloat: rmoney(openingFloat), openedAt: Date.now(), openedBy: App.user.id, closedAt: null };
    this.data.shifts.push(shift);
    this.save();
    return shift;
  },

  // The other cash that left or entered the drawer (cash expenses and purchases, the owner's cash moves).
  // Cashier devices are sent only the cash ones, which is all the drawer needs.
  shiftExtras() {
    return { expenses: this.data.expenses, purchases: this.data.purchases, ownerMoves: this.data.ownerMoves, customerPayments: this.data.customerPayments };
  },

  // The server works out the expected cash itself; in local mode it is worked out here.
  closeShift(shift, countedCash, note) {
    shift.countedCash = rmoney(countedCash);
    shift.note = note;
    if (!this.server) {
      shift.closedAt = Date.now();
      shift.closedBy = App.user.id;
      const sums = computeShift(shift, this.data.orders, decimalsOf(this.settings), this.data.supplierPayments, this.shiftExtras());
      Object.assign(shift, { expectedCash: sums.expected, difference: rmoney(shift.countedCash - sums.expected), cashIn: sums.cashIn, cashOut: sums.cashOut, payouts: sums.payouts, spent: sums.spent, bought: sums.bought, ownerIn: sums.ownerIn, ownerOut: sums.ownerOut, received: sums.received, tips: sums.tips, sales: sums.sales, orders: sums.orders });
    } else {
      shift.closedAt = Date.now(); // marks the close request; the server replaces every figure
    }
    this.save();
  },
});
