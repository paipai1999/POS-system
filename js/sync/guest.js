'use strict';

// A guest's phone or a table tablet: the menu and the requests, without signing in.
Object.assign(Sync, {
  // ----- guests -----
  async startGuest(code) {
    this.disconnect();
    this.setToken(null);
    this.synced = {};
    this.guestCode = code;
    await this.refreshGuest();
    const es = new EventSource('/api/guest/events?table=' + encodeURIComponent(code));
    this.es = es;
    let t = null;
    es.onmessage = () => {
      clearTimeout(t);
      t = setTimeout(() => this.refreshGuest().then(() => App.liveRefresh(['guest'])).catch(() => {}), 300);
    };
  },

  async refreshGuest() {
    const d = await this.api('/api/guest/state?table=' + encodeURIComponent(this.guestCode));
    Store.data = { ...this.emptyData(), ...d };
    Store.sortCategories();
  },

  async guestRequest(req) {
    await this.api('/api/guest/request', {
      method: 'POST',
      body: { table: this.guestCode, kind: req.kind, note: req.note, items: req.items.map(l => ({ productId: l.productId, qty: l.qty })) },
    });
    await this.refreshGuest();
  },

  leaveGuest() {
    this.disconnect();
    this.guestCode = null;
  },
});
