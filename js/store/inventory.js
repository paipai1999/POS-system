'use strict';

// Ingredients coming in and going out: suppliers, purchases, payments to suppliers and stocktakes.
Object.assign(Store, {
  // ----- ingredients: purchases and stocktakes -----
  // In server mode the server adds the stock (and works out the cost) itself; single-device mode does it here.
  // `paid` is what was paid now (default: all of it); what is not paid is owed to the supplier, who must be on the list.
  addSupplier({ name, phone = '', note = '' }) {
    name = String(name || '').trim();
    if (!name) throw new Error('Supplier name is required');
    if (this.data.suppliers.some(s => s.name.toLowerCase() === name.toLowerCase())) throw new Error('A supplier with that name already exists');
    const s = { id: uid('s_'), name, phone: String(phone).trim(), note: String(note).trim(), active: true, owed: 0 };
    this.data.suppliers.push(s);
    this.save();
    return s;
  },

  // `payMethod` is how the part paid now left the business (cash comes out of the till); `taxAmount` is the tax inside the price.
  addPurchase({ supplierId = null, supplier = '', note = '', lines, paid = null, payMethod = 'cash', taxAmount = 0 }) {
    this.assertDayOpen(Date.now(), 'nothing can be added to it');
    const dec = decimalsOf(this.settings);
    const purchase = {
      id: uid('pu_'), date: Date.now(), supplier: supplier.trim(), note: note.trim(), by: App.user.id, status: 'received',
      lines: lines.map(l => ({ ingredientId: l.ingredientId, qty: round4(l.qty), total: roundTo(l.total, dec) })),
    };
    purchase.total = roundTo(purchase.lines.reduce((n, l) => n + l.total, 0), dec);
    const sup = supplierId ? this.supplier(supplierId) : null;
    if (sup) { purchase.supplierId = sup.id; purchase.supplier = sup.name; }
    purchase.paid = paid === null || paid === '' ? purchase.total : roundTo(paid, dec);
    purchase.payMethod = ['cash', 'card', 'other'].includes(payMethod) ? payMethod : 'other';
    purchase.taxAmount = roundTo(taxAmount || 0, dec);
    if (!(purchase.taxAmount >= 0) || purchase.taxAmount > purchase.total + 0.005) throw new Error('The tax cannot be more than the amount');
    if (!(purchase.paid >= 0) || purchase.paid > purchase.total + 0.005) throw new Error('The amount paid must be between 0 and the total');
    if (!sup && purchase.paid < purchase.total) throw new Error('Choose a supplier to record an amount that is still owed');
    if (!this.server) {
      receivePurchase(purchase, id => this.ingredient(id));
      if (sup) sup.owed = roundTo((sup.owed || 0) + purchase.total - purchase.paid, dec);
    }
    this.data.purchases.push(purchase);
    this.save();
    return purchase;
  },

  voidPurchase(purchase) {
    this.assertDayOpen(purchase.date, 'this purchase cannot be voided');
    purchase.status = 'void';
    purchase.voidedAt = Date.now();
    purchase.voidedBy = App.user.id;
    if (!this.server) {
      voidPurchase(purchase, id => this.ingredient(id));
      const sup = purchase.supplierId && this.supplier(purchase.supplierId);
      if (sup) sup.owed = roundTo((sup.owed || 0) - (purchase.total - (purchase.paid ?? purchase.total)), decimalsOf(this.settings));
    }
    this.save();
  },

  // Paying a supplier takes from what is owed to them; a cash payment also leaves the till (the drawer counts it).
  addSupplierPayment({ supplierId, amount, method = 'cash', note = '' }) {
    this.assertDayOpen(Date.now(), 'nothing can be added to it');
    const dec = decimalsOf(this.settings);
    const sup = this.supplier(supplierId);
    if (!sup) throw new Error('That supplier no longer exists');
    amount = roundTo(amount, dec);
    if (!(amount > 0)) throw new Error('Enter the amount paid');
    if (amount > (sup.owed || 0) + 0.005) throw new Error(`Only ${roundTo(sup.owed || 0, dec)} is owed to ${sup.name}`);
    const payment = { id: uid('sp_'), supplierId, supplierName: sup.name, date: Date.now(), amount, method: method === 'other' ? 'other' : 'cash', note: String(note).trim(), by: App.user.id, status: 'paid' };
    this.data.supplierPayments.push(payment);
    if (!this.server) sup.owed = roundTo((sup.owed || 0) - amount, dec);
    this.save();
    return payment;
  },

  voidSupplierPayment(payment) {
    this.assertDayOpen(payment.date, 'this payment cannot be voided');
    payment.status = 'void';
    payment.voidedAt = Date.now();
    payment.voidedBy = App.user.id;
    const sup = this.supplier(payment.supplierId);
    if (!this.server && sup) sup.owed = roundTo((sup.owed || 0) + payment.amount, decimalsOf(this.settings));
    this.save();
  },

  // lines: [{ kind: 'ingredient' | 'product', refId, counted }]
  addStocktake({ note = '', lines }) {
    const st = { id: uid('st_'), date: Date.now(), by: App.user.id, note: note.trim(), lines: lines.map(l => ({ ...l })) };
    if (!this.server) st.value = applyStocktake(st, id => this.ingredient(id), id => this.product(id), decimalsOf(this.settings)).value;
    this.data.stocktakes.push(st);
    this.save();
    return st;
  },

  lowIngredients() {
    return this.data.ingredients.filter(i => i.active !== false && i.stock <= i.lowStock);
  },
});
