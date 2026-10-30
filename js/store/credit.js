'use strict';

// Customers paying what they owe on their account, and deposits paid in advance (bills are put on account at checkout, see store/orders.js).
// In server mode the server checks and completes each payment (server/rules/receivables.js); single-device mode applies the same
// rules here. A write-off clears a debt that will not be paid; a closed day is locked.
Object.assign(Store, {
  // method: 'cash' | 'card' | 'other' | 'writeoff'
  // kind: 'payment' (towards what the customer owes), 'deposit' (paid in advance: puts the account in credit, to be used on a later
  // bill put on account) or 'depositRefund' (a deposit given back, approved by a manager: `approvedBy`).
  addCustomerPayment({ customerId, amount, method = 'cash', note = '', kind = 'payment', reservationId = null, approvedBy = null }) {
    const dec = decimalsOf(this.settings);
    const c = this.customer(customerId);
    if (!c) throw new Error('That customer no longer exists');
    if (!['payment', 'deposit', 'depositRefund'].includes(kind)) throw new Error('Invalid payment');
    if (!['cash', 'card', 'other', 'writeoff'].includes(method) || (kind !== 'payment' && method === 'writeoff')) throw new Error('Choose how the customer paid');
    if (method === 'writeoff' && !App.can('manage')) throw new Error('You do not have permission to do that');
    amount = roundTo(amount, dec);
    if (!(amount > 0) || amount > 1e12) throw new Error('Enter the amount');
    const credit = roundTo(Math.max(0, -(c.owing || 0)), dec);
    if (kind === 'payment' && amount > (c.owing || 0) + 0.005) throw new Error(`Only ${roundTo(c.owing || 0, dec)} is owed by ${c.name}`);
    if (kind === 'depositRefund') {
      if (amount > credit + 0.005) throw new Error(`Only ${credit} of ${c.name}'s deposit is left to give back`);
      if (!App.can('manage') && !approvedBy) throw new Error('Manager approval required');
    }
    this.assertDayOpen(Date.now(), 'nothing can be added to it');
    const payment = { id: uid('cp_'), customerId, customerName: c.name, date: Date.now(), amount, method, note: String(note).trim().slice(0, 200), by: App.user.id, status: 'received' };
    if (kind !== 'payment') payment.kind = kind;
    if (kind === 'deposit' && reservationId) payment.reservationId = reservationId;
    if (kind === 'depositRefund') payment.approvedBy = approvedBy || App.user.id;
    this.data.customerPayments.push(payment);
    if (!this.server) c.owing = roundTo((c.owing || 0) + (kind === 'depositRefund' ? amount : -amount), dec);
    this.save();
    return payment;
  },

  voidCustomerPayment(payment) {
    this.assertDayOpen(payment.date, 'this payment cannot be voided');
    const c = this.customer(payment.customerId);
    if (c && payment.kind === 'deposit' && -(c.owing || 0) < payment.amount - 0.005) throw new Error('This deposit has already been used on a bill, so it cannot be voided.');
    payment.status = 'void';
    payment.voidedAt = Date.now();
    payment.voidedBy = App.user.id;
    if (!this.server && c) c.owing = roundTo((c.owing || 0) + (payment.kind === 'depositRefund' ? -payment.amount : payment.amount), decimalsOf(this.settings));
    this.save();
  },

  // What a reservation has been paid in advance (deposits received for it that were not voided).
  depositFor(reservationId) {
    return roundTo(this.data.customerPayments.filter(p => p.kind === 'deposit' && p.reservationId === reservationId && p.status !== 'void').reduce((n, p) => n + p.amount, 0), decimalsOf(this.settings));
  },
});
