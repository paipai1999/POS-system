'use strict';

// Settings (admin only). This file draws the page and saves the settings; tables, QR codes and the printer station, the
// activity log and backups are in tables.js, qr.js, audit.js and backup.js.

Screens.settings = {
  perm: 'settings',

  live: ['settings', 'tables'],

  root: null,

  // The member-level rows being edited; copied from the settings when the screen opens.
  tiers: [],

  leave() { this.tiersLoaded = false; },

  render(root) {
    this.root = root;
    const s = Store.settings;
    if (!this.tiersLoaded || this.tiersFor !== s) { this.tiers = loyaltyOf(s).tiers.map(t => ({ ...t })); this.tiersLoaded = true; this.tiersFor = s; }
    const server = Store.server;
    root.innerHTML = `
      <div class="page-head"><h1>Settings</h1></div>
      <div class="settings-grid">
        <section class="card" data-role="general">
          ${this.generalHTML(s)}
          ${this.loyaltyHTML(s)}
          <button class="btn primary" data-act="save">Save settings</button>
        </section>

        ${this.financeHTML(s)}

        ${this.tablesHTML(server)}

        ${server ? this.deviceHTML() : ''}

        ${server ? this.auditHTML() : ''}

        ${this.printingHTML(server)}

        ${this.backupHTML(server)}
      </div>`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      const id = t.dataset.id;
      switch (t.dataset.act) {
        case 'save': this.save(); break;
        case 'save-finance': this.saveFinance(); break;
        case 'tier-add':
          this.tiers.push({ name: '', minSpent: '', earnPercent: '', discountPercent: '' });
          root.querySelector('[data-role=tiers]').innerHTML = this.tierRows();
          break;
        case 'tier-del':
          this.tiers.splice(+t.dataset.i, 1);
          root.querySelector('[data-role=tiers]').innerHTML = this.tierRows();
          break;
        case 'add-table': this.addTable(); break;
        case 'rename-table': this.renameTable(id); break;
        case 'del-table': this.deleteTable(id); break;
        case 'qr': this.showQR(); break;
        case 'audit': this.showAudit(); break;
        case 'backup-now': this.backupNow(); break;
        case 'backup-folders': this.backupFolders(); break;
        case 'test-print-here': printLocal(testPageHTML()); break;
        case 'test-print-station': printHTML(testPageHTML()); break;
        case 'export': this.exportData(); break;
        case 'reset':
          confirmDialog({
            title: 'Reset all data?',
            message: `This deletes every order, item, staff member and setting${server ? ' on every device' : ''}, and restores the demo data. Export a backup first if you need it.`,
            okLabel: 'Reset everything',
            danger: true,
            onOk: () => this.resetData(),
          });
          break;
      }
    };
    root.oninput = e => {
      const row = e.target.closest('.tier-row');
      if (row && e.target.dataset.f) this.tiers[+row.dataset.i][e.target.dataset.f] = e.target.value;
    };
    root.onchange = e => {
      if (e.target.dataset.role === 'preset' && e.target.value) {
        const [symbol, decimals, after] = { usd: ['$', '2', '0'], mmk: ['Ks', '0', '1'] }[e.target.value];
        const box = root.querySelector('[data-role=general]');
        box.querySelector('[name=currency]').value = symbol;
        box.querySelector('[name=decimals]').value = decimals;
        box.querySelector('[name=currencyAfter]').value = after;
      }
      if (e.target.dataset.role === 'import' && e.target.files[0]) this.importFile(e.target.files[0]);
      if (e.target.dataset.role === 'station') this.toggleStation(e.target);
    };
    root.querySelector('[data-role=new-table]').onkeydown = e => { if (e.key === 'Enter') this.addTable(); };
    if (server) this.loadBackupStatus();
  },

  // Addresses other devices can use. "localhost" only works on the server PC itself.
  addresses() {
    const port = location.port ? ':' + location.port : '';
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    const hosts = local ? Sync.addresses : [location.hostname];
    return hosts.length ? hosts.map(h => `${location.protocol}//${h}${port}`) : [location.origin];
  },

  // Reads the form, checks it, and stores it. Each part of the form is checked by the file that draws it.
  save() {
    const v = formValues(this.root.querySelector('[data-role=general]'));
    let patch;
    try { patch = { ...this.readGeneral(v), loyalty: this.readLoyalty(v) }; } catch (e) { return toast(e.message, 'error'); }
    Object.assign(Store.settings, patch);
    this.tiersLoaded = false; // show the saved (sorted) levels
    Store.save();
    App.render();
    toast('Settings saved', 'ok');
  },
};
