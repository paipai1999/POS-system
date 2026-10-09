'use strict';

// The app itself: who is signed in, which screen is showing, starting up and moving between screens.
// The other files in js/app/ add the parts: registry.js (the screens list and the menu), topbar.js (the menu bar),
// live.js (reacting to changes from other devices) and session.js (signing out, guest mode).

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
      if (b.dataset.nav === 'menu') $('#topbar').classList.toggle('menu-open'); // the ☰ button on phones
      else if (b.dataset.nav === 'lang') { I18N.toggle(); this.render(); }
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
    $('#topbar').classList.remove('menu-open');
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
};

document.addEventListener('DOMContentLoaded', () => App.init());
