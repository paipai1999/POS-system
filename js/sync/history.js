'use strict';

// Records older than what a device is sent at sign-in are fetched when a screen needs them.
Object.assign(Sync, {
  // ----- order history outside the window loaded at sign-in -----
  ordersLoaded(from) {
    return !Store.server || !this.token || from >= this.loadedSince;
  },

  loadOrders(from) {
    if (this.ordersLoaded(from)) return Promise.resolve();
    if (!this.orderLoads[from]) {
      this.orderLoads[from] = this.api(`/api/orders?from=${from}&to=${this.loadedSince}`).then(r => {
        this.applyRemote(r.rows, { advanceSeq: false });
        this.loadedSince = Math.min(this.loadedSince, from);
      }).finally(() => { delete this.orderLoads[from]; });
    }
    return this.orderLoads[from];
  },

  // ----- purchases, supplier payments, stocktakes, expenses and the owner's money moves -----
  ledgerLoaded(from) {
    return !Store.server || !this.token || from >= this.ledgerSince;
  },

  loadLedger(from) {
    if (this.ledgerLoaded(from)) return Promise.resolve();
    if (!this.ledgerLoads[from]) {
      this.ledgerLoads[from] = this.api(`/api/ledger?from=${from}&to=${this.ledgerSince}`).then(r => {
        this.applyRemote(r.rows, { advanceSeq: false });
        this.ledgerSince = Math.min(this.ledgerSince, from);
      }).finally(() => { delete this.ledgerLoads[from]; });
    }
    return this.ledgerLoads[from];
  },

  // How far back this device holds every bill and money record (0 in single-device mode, where it has them all).
  historySince() {
    return Store.server && this.token ? Math.max(this.loadedSince, this.ledgerSince) : 0;
  },

  // Everything a financial statement needs from `from` onwards (resolves at once in single-device mode).
  historyLoaded(from) {
    return this.ordersLoaded(from) && this.ledgerLoaded(from);
  },

  loadHistory(from) {
    return Promise.all([this.loadOrders(from), this.loadLedger(from)]);
  },
});
