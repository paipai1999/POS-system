'use strict';

// The menu bar at the top: one button per screen the signed-in person may use, the sync indicator and the language switch.
Object.assign(App, {
  renderTopbar() {
    if (!this.user) return;
    const pending = this.can('guest') ? Store.pendingRequests().length : 0;
    const ready = this.can('tables') ? Store.readyTickets().length : 0;
    const active = this.screen === 'order' ? 'tables' : this.screen;
    $('#topbar').innerHTML = `
      <div class="brand">🍽️ ${esc(Store.settings.name)}</div>
      <button class="nav-toggle" data-nav="menu" aria-label="Menu" aria-expanded="false">☰</button>
      <nav>
        ${NAV.filter(n => this.can(n.perm)).map(n => `
          <button class="nav-btn ${active === n.id ? 'active' : ''}" data-nav="${n.id}" title="${n.label}">
            ${n.icon} <span>${I18N.navLabel(n)}</span>${n.id === 'tables' && pending + ready ? `<b class="badge">${pending + ready}</b>` : ''}
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
});
