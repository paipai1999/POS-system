'use strict';

// Each screen registers itself here:
// { perm?, fullscreen?, live?: [collections that should re-render it], render(root, params), refresh?(), leave?(params) }
const Screens = {};

const NAV = [
  { id: 'tables', label: 'Tables', icon: '🪑', perm: 'tables' },
  { id: 'kitchen', label: 'Kitchen', icon: '👨‍🍳', perm: 'kitchen' },
  { id: 'orders', label: 'Orders', icon: '🧾', perm: 'orders' },
  { id: 'drawer', label: 'Cash drawer', icon: '💰', perm: 'checkout' },
  { id: 'products', label: 'Menu & Stock', icon: '📦', perm: 'products' },
  { id: 'inventory', label: 'Inventory', icon: '🧂', perm: 'products' },
  { id: 'customers', label: 'Customers', icon: '👤', perm: 'checkout' },
  { id: 'reports', label: 'Reports', icon: '📊', perm: 'reports' },
  { id: 'users', label: 'Staff', icon: '👥', perm: 'users' },
  { id: 'settings', label: 'Settings', icon: '⚙️', perm: 'settings' },
];

const App = {
  user: null,
  screen: null,
  params: {},
  keyHandler: null,
  deferredRender: false,

  async init() {
    I18N.init();
    Modal.init();

    $('#topbar').addEventListener('click', e => {
      const b = e.target.closest('[data-nav]');
      if (!b) return;
      if (b.dataset.nav === 'lang') { I18N.toggle(); this.render(); }
      else if (b.dataset.nav === 'logout') this.logout();
      else this.go(b.dataset.nav);
    });

    document.addEventListener('keydown', e => {
      if (Modal.isOpen) return Modal.onKey(e);
      if (this.keyHandler && !e.target.matches('input, textarea, select')) this.keyHandler(e);
    });

    // A live update must not wipe what someone is typing; it is applied when they leave the field.
    $('#main').addEventListener('focusout', () => {
      if (!this.deferredRender) return;
      setTimeout(() => {
        if (this.deferredRender && !this.isTyping()) { this.deferredRender = false; this.refreshScreen(); }
      }, 0);
    });

    // Refresh "x min ago" labels on the tables screen.
    setInterval(() => { if (this.screen === 'tables' && !Modal.isOpen && !this.isTyping()) this.render(); }, 30000);

    $('#main').innerHTML = '<p class="empty">Connecting…</p>';
    Sync.enabled = await Sync.detect();
    if (Sync.enabled) return this.initServer();

    Store.load();
    // Keeps several tabs on the same device in sync (e.g. a guest-menu tab and a staff tab).
    window.addEventListener('storage', e => {
      if (e.key !== STORE_KEY) return;
      const before = Store.pendingRequests().length;
      if (!Store.syncFrom(e.newValue)) return;
      if (this.user) {
        this.user = Store.user(this.user.id);
        if (!this.user || !this.user.active) return this.logout();
        if (this.can('guest') && Store.pendingRequests().length > before) toast('🔔 New guest request', 'ok');
      }
      this.render();
    });
    this.go('login');
  },

  async initServer() {
    Store.mode = 'server';
    Station.init();
    Station.start();
    window.addEventListener('beforeunload', e => {
      if (Sync.pendingCount()) { e.preventDefault(); e.returnValue = ''; }
    });

    // A guest scanned the QR code on their table.
    const code = new URLSearchParams(location.search).get('table');
    if (code) {
      try {
        await Sync.startGuest(code);
        Screens.guest.reset();
        Screens.guest.state.tableId = Store.data.tables[0].id;
        Screens.guest.state.locked = true;
        return this.go('guest');
      } catch (e) {
        $('#main').innerHTML = `<div class="login-wrap"><div class="login-card"><div class="login-brand">🍽️</div><h1>Sorry</h1><p class="muted">${esc(e.message)}</p></div></div>`;
        return;
      }
    }

    try {
      const user = await Sync.restoreSession();
      if (user) {
        this.user = user;
        return this.go(this.firstScreen());
      }
      await Sync.loadPublic();
      this.go('login');
    } catch (e) {
      $('#main').innerHTML = `<p class="empty">${esc(e.message)} <button class="btn small" data-act="retry">Retry</button></p>`;
      $('#main').onclick = ev => { if (ev.target.closest('[data-act=retry]')) location.reload(); };
    }
  },

  // Someone signed in with a demo PIN has to choose their own before they can use the POS.
  checkPin() {
    if (this.user && Store.mustChangePin(this.user)) forcePinChange();
  },

  can(perm, user = this.user) {
    return !!user && !!ROLES[user.role] && ROLES[user.role].perms.includes(perm);
  },

  firstScreen() {
    const item = NAV.find(n => this.can(n.perm));
    return item ? item.id : 'login';
  },

  go(screen, params = {}) {
    const current = Screens[this.screen];
    if (current && current.leave) current.leave(this.params);
    Modal.close(true);
    const target = Screens[screen];
    if (!target || (target.perm && !this.can(target.perm))) {
      screen = this.user ? this.firstScreen() : 'login';
      params = {};
    }
    this.screen = screen;
    this.params = params;
    this.deferredRender = false;
    this.render();
    this.checkPin();
  },

  render() {
    const scr = Screens[this.screen];
    if (!scr) return;
    this.keyHandler = null;
    const topbar = $('#topbar');
    topbar.hidden = !!scr.fullscreen;
    if (!scr.fullscreen) this.renderTopbar();
    const main = $('#main');
    main.className = 'main screen-' + this.screen;
    main.onclick = main.oninput = main.onchange = null;
    scr.render(main, this.params);
  },

  renderTopbar() {
    if (!this.user) return;
    const pending = this.can('guest') ? Store.pendingRequests().length : 0;
    const ready = this.can('tables') ? Store.readyTickets().length : 0;
    const active = this.screen === 'order' ? 'tables' : this.screen;
    $('#topbar').innerHTML = `
      <div class="brand">🍽️ ${esc(Store.settings.name)}</div>
      <nav>
        ${NAV.filter(n => this.can(n.perm)).map(n => `
          <button class="nav-btn ${active === n.id ? 'active' : ''}" data-nav="${n.id}" title="${n.label}">
            ${n.icon} <span>${n.label}</span>${n.id === 'tables' && pending + ready ? `<b class="badge">${pending + ready}</b>` : ''}
          </button>`).join('')}
      </nav>
      ${Store.server ? '<span id="sync-status" class="sync-status"></span>' : ''}
      <div class="who">
        ${I18N.button('lang')}
        <span>${esc(this.user.name)}<small>${ROLES[this.user.role].label}</small></span>
        <button class="btn small" data-nav="logout">Log out</button>
      </div>`;
    this.renderSyncStatus();
  },

  renderSyncStatus() {
    const el = $('#sync-status');
    if (!el) return;
    const n = Sync.pendingCount();
    if (!Sync.online) {
      el.className = 'sync-status offline';
      el.textContent = n ? `Offline · ${n} waiting` : 'Offline';
      el.title = 'Cannot reach the POS server. Changes are kept on this device and sent when the connection is back.';
    } else if (n) {
      el.className = 'sync-status busy';
      el.textContent = 'Saving…';
      el.title = '';
    } else {
      el.className = 'sync-status live';
      el.textContent = 'Live';
      el.title = 'Connected to the POS server';
    }
  },

  isTyping() {
    const a = document.activeElement;
    return !!a && $('#main').contains(a) && a.matches('input:not([type=checkbox]), textarea, select');
  },

  // Re-render after data changed on another device, if the current screen shows that data.
  liveRefresh(cols) {
    if (this.user && !Screens[this.screen]?.fullscreen) this.renderTopbar();
    const scr = Screens[this.screen];
    if (!scr) return;
    if (scr.live && !cols.some(c => scr.live.includes(c))) return;
    if (this.isTyping()) { this.deferredRender = true; return; }
    this.refreshScreen();
  },

  refreshScreen() {
    const scr = Screens[this.screen];
    if (scr && scr.refresh) scr.refresh();
    else this.render();
  },

  // Alerts for events that happened on other devices.
  onRemote(events) {
    for (const ev of events) {
      const d = ev.doc;
      if (!d) continue;
      if (ev.col === 'guestRequests' && ev.isNew && d.status === 'pending' && this.can('guest')) {
        const t = Store.table(d.tableId);
        toast(`🔔 ${t ? t.name : 'A table'}: ${d.kind === 'call' ? 'guest is calling a waiter' : 'new guest order'}`, 'ok');
        beep();
      }
      if (ev.col === 'kitchenTickets') {
        if (d.status === 'ready' && (!ev.before || ev.before.status !== 'ready') && this.user && d.staffId === this.user.id) {
          toast(`🍽️ ${d.where} #${orderNo(Store.order(d.orderId) || d)} is ready to serve`, 'ok');
          beep(2);
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        }
        if (ev.isNew && d.status === 'new' && this.screen === 'kitchen') beep();
      }
    }
    const me = this.user && Store.user(this.user.id);
    if (this.user && (!me || !me.active)) return this.sessionExpired();
    this.liveRefresh([...new Set(events.map(e => e.col))]);
  },

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
};

document.addEventListener('DOMContentLoaded', () => App.init());
