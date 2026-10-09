'use strict';

// Requests from guests who scanned a table's QR code.
Object.assign(Store, {
  pendingRequests() {
    return this.data.guestRequests.filter(r => r.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
  },

  // Turns a guest's request into items on the table's open order. Unavailable items are skipped.
  acceptGuestRequest(id, staffId) {
    const req = this.data.guestRequests.find(r => r.id === id);
    if (!req || req.status !== 'pending') return null;
    if (!this.table(req.tableId)) {
      this.resolveRequest(id, 'rejected', staffId);
      return { order: null, skipped: ['table no longer exists'] };
    }
    const existing = this.openOrderForTable(req.tableId);
    const order = existing || this.createOrder({ tableId: req.tableId, staffId });
    const skipped = [];
    for (const l of req.items) {
      const p = this.product(l.productId);
      if (!p || !p.active) { skipped.push(l.name); continue; }
      const qty = Math.min(l.qty, this.available(p));
      if (qty < l.qty) skipped.push(l.name);
      if (qty > 0) this.addItem(order, p, qty);
    }
    if (req.note) order.note = [order.note, 'Guest: ' + req.note].filter(Boolean).join(' / ');
    req.status = 'accepted';
    req.handledBy = staffId;
    req.handledAt = Date.now();
    if (!existing && !order.items.length) {
      this.removeOrder(order.id);
      return { order: null, skipped };
    }
    this.save();
    return { order, skipped };
  },

  resolveRequest(id, status, staffId) {
    const req = this.data.guestRequests.find(r => r.id === id);
    if (!req) return;
    req.status = status;
    req.handledBy = staffId;
    req.handledAt = Date.now();
    this.pruneRequests();
    this.save();
  },

  // Returns a promise in server mode (guests post to the server instead of writing data directly).
  addGuestRequest(req) {
    if (this.server) return Sync.guestRequest(req);
    this.data.guestRequests.push({ id: uid('g_'), status: 'pending', createdAt: Date.now(), ...req });
    this.pruneRequests();
    this.save();
    return Promise.resolve();
  },

  pruneRequests() {
    const handled = this.data.guestRequests.filter(r => r.status !== 'pending');
    if (handled.length <= 100) return;
    const drop = new Set(handled.slice(0, handled.length - 100).map(r => r.id));
    this.data.guestRequests = this.data.guestRequests.filter(r => !drop.has(r.id));
  },
});
