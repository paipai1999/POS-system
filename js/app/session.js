'use strict';

// Signing out, an expired session, and handing the device to guests (guest menu mode).
Object.assign(App, {
  async logout() {
    if (!Store.server) {
      this.user = null;
      return this.go('login');
    }
    const n = Sync.pendingCount();
    const leave = async () => {
      this.user = null;
      try { await Sync.logout(); } catch (e) { /* still go to the login screen */ }
      this.go('login');
    };
    if (n && !Sync.online) {
      return confirmDialog({
        title: 'Log out while offline?',
        message: `${n} change${n === 1 ? ' has' : 's have'} not reached the server yet and will be lost.`,
        okLabel: 'Log out anyway',
        danger: true,
        onOk: leave,
      });
    }
    if (n) await Sync.flush();
    leave();
  },

  sessionExpired() {
    toast('Please sign in again', 'error');
    Sync.disconnect();
    Sync.setToken(null);
    this.user = null;
    Sync.loadPublic().catch(() => {}).finally(() => this.go('login'));
  },

  // Hands this device to guests for one table. In server mode the device signs out and keeps only the menu.
  async enterGuest(tableId) {
    const table = Store.table(tableId);
    if (!table) return;
    Screens.guest.reset();
    if (Store.server) {
      try {
        if (Sync.pendingCount()) await Sync.flush();
        await Sync.logout();
        this.user = null;
        await Sync.startGuest(table.guestCode);
        Screens.guest.state.tableId = Store.data.tables[0].id;
      } catch (e) {
        return toast(e.message, 'error');
      }
    } else {
      this.user = null;
      Screens.guest.state.tableId = table.id;
    }
    this.go('guest');
  },

  async exitGuest() {
    Screens.guest.reset();
    this.user = null;
    if (Store.server) {
      Sync.leaveGuest();
      if (location.search) history.replaceState(null, '', location.pathname);
      try { await Sync.loadPublic(); } catch (e) { toast(e.message, 'error'); }
    }
    this.go('login');
  },
});
