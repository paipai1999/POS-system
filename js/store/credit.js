'use strict';

// Customers paying what they owe on their account (bills are put on account at checkout, see store/orders.js).
// In server mode the server checks and completes each payment (server/rules/receivables.js); single-device mode applies the same
// rules here. A write-off clears a debt that will not be paid; a closed day is locked.
Object.assign(Store, {
  // method: 'cash' | 'card' | 'other' | 'writeoff'
  addCustomerPayment({ customerId, amount, method = 'cash', note = '' }) {
    const dec = decimalsOf(this.settings);
    const c = this.customer(customerId);
    if (!c) throw new Error('That customer no longer exists');
    if (!['cash', 'card', 'other', 'writeoff'].includes(method)) throw new Error('Choose how the customer paid');
    if (method === 'writeoff' && !App.can('manage')) throw new Error('You do not have permission to do that');
    amount = roundTo(amount, dec);
    if (!(amount > 0) || amount > 1e12) throw new Error('Enter the amount');
    if (amount > (c.owing || 0) + 0.005) throw new Error(`Only ${roundTo(c.owing || 0, dec)} is owed by ${c.name}`);
    this.assertDayOpen(Date.now(), 'nothing can be added to it');
    const payment = { id: uid('cp_'), customerId, customerName: c.name, date: Date.now(), amount, method, note: String(note).trim().slice(0, 200), by: App.user.id, status: 'received' };
    this.data.customerPayments.push(payment);
    if (!this.server) c.owing = roundTo((c.owing || 0) - amount, dec);
    this.save();
    return payment;
  },

  voidCustomerPayment(payment) {
    this.assertDayOpen(payment.date, 'this payment cannot be voided');
    payment.status = 'void';
    payment.voidedAt = Date.now();
    payment.voidedBy = App.user.id;
    const c = this.customer(payment.customerId);
    if (!this.server && c) c.owing = roundTo((c.owing || 0) + payment.amount, decimalsOf(this.settings));
    this.save();
  },
});
