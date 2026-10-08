'use strict';

Screens.settings = {
  perm: 'settings',
  live: ['settings', 'tables'],
  root: null,

  render(root) {
    this.root = root;
    const s = Store.settings;
    const server = Store.server;
    root.innerHTML = `
      <div class="page-head"><h1>Settings</h1></div>
      <div class="settings-grid">
        <section class="card" data-role="general">
          <h2>Restaurant &amp; receipts</h2>
          <label class="field"><span>Restaurant name</span><input class="input" name="name" value="${esc(s.name)}"></label>
          <label class="field"><span>Address</span><input class="input" name="address" value="${esc(s.address)}"></label>
          <label class="field"><span>Phone</span><input class="input" name="phone" value="${esc(s.phone)}"></label>
          <div class="grid-3">
            <label class="field"><span>Currency symbol</span><input class="input" name="currency" value="${esc(s.currency)}" maxlength="4"></label>
            <label class="field"><span>Tax %</span><input class="input" name="taxRate" type="number" min="0" max="100" step="0.01" value="${s.taxRate}"></label>
            <label class="field"><span>Service charge %</span><input class="input" name="serviceRate" type="number" min="0" max="100" step="0.01" value="${s.serviceRate}"></label>
          </div>
          <label class="field"><span>Receipt footer</span><input class="input" name="receiptFooter" value="${esc(s.receiptFooter)}"></label>
          <label class="check"><input type="checkbox" name="printKitchenTickets" ${s.printKitchenTickets ? 'checked' : ''}> Also print a kitchen ticket when items are sent</label>
          <button class="btn primary" data-act="save">Save settings</button>
        </section>

        <section class="card">
          <h2>Tables</h2>
          <div class="list">
            ${Store.data.tables.map(t => `
              <div class="list-row">
                <span>🪑 ${esc(t.name)}</span>
                <div class="row-actions">
                  <button class="btn small" data-act="rename-table" data-id="${t.id}">Rename</button>
                  <button class="btn small danger" data-act="del-table" data-id="${t.id}">Delete</button>
                </div>
              </div>`).join('') || '<p class="empty small">No tables yet.</p>'}
          </div>
          <div class="inline-add">
            <input class="input" data-role="new-table" placeholder="e.g. Table 11 or Patio 1">
            <button class="btn" data-act="add-table">Add table</button>
          </div>
          <div class="spaced">
            <button class="btn" data-act="qr" ${server && Store.data.tables.length ? '' : 'disabled'}>🔳 Print table QR codes</button>
            ${server ? '' : '<p class="muted small">QR ordering needs the POS server (see README).</p>'}
          </div>
        </section>

        ${server ? `
        <section class="card">
          <h2>This device</h2>
          <p class="muted small">Open the POS on other phones and tablets on the same Wi-Fi:</p>
          <div class="address-list">${this.addresses().map(a => `<code>${esc(a)}</code>`).join('')}</div>
          <label class="check spaced"><input type="checkbox" data-role="station" ${Station.active ? 'checked' : ''}> This device is the printer station</label>
          <p class="muted small">Bills, receipts and kitchen tickets from waiters' phones print here. ${Sync.stations ? `<b>${Sync.stations} station${Sync.stations > 1 ? 's' : ''} online.</b>` : 'No station is online, so each device prints for itself.'}</p>
        </section>` : ''}

        <section class="card">
          <h2>Printing</h2>
          <p class="muted small">Print a test page after connecting a printer: it checks the paper width, the paper cut and Myanmar text. In the print window choose the receipt printer, paper size 80 mm and margins "None".</p>
          <div class="stack">
            <button class="btn" data-act="test-print-here">🖨️ Print test page on this device</button>
            ${server ? `<button class="btn" data-act="test-print-station" ${Station.active || !Sync.stations ? 'disabled' : ''}>🖨️ Send test page to the printer station</button>` : ''}
          </div>
        </section>

        <section class="card">
          <h2>Data &amp; backup</h2>
          <p class="muted small">${server
            ? 'Data is stored on the POS server in <code>server/data/pos.db</code>. A copy is saved automatically every day in <code>server/data/backups</code>.'
            : 'Everything is stored in this browser on this device. Export a backup regularly, and before clearing browser data.'}</p>
          ${server ? `
            <div data-role="backup-status" class="backup-status"><p class="muted small">Checking backups…</p></div>
            <div class="stack">
              <button class="btn" data-act="backup-now">💾 Back up now</button>
              <button class="btn" data-act="backup-folders">📁 Backup folders (USB / cloud)…</button>
            </div>` : ''}
          <div class="stack spaced">
            <button class="btn" data-act="export">⬇️ Export backup</button>
            <label class="btn">⬆️ Import backup<input type="file" accept=".json,application/json" data-role="import" hidden></label>
            <button class="btn danger" data-act="reset">Reset to demo data</button>
          </div>
        </section>
      </div>`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      const id = t.dataset.id;
      switch (t.dataset.act) {
        case 'save': this.save(); break;
        case 'add-table': this.addTable(); break;
        case 'rename-table': this.renameTable(id); break;
        case 'del-table': this.deleteTable(id); break;
        case 'qr': this.showQR(); break;
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
    root.onchange = e => {
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

  save() {
    const v = formValues(this.root.querySelector('[data-role=general]'));
    const tax = parseFloat(v.taxRate);
    const service = parseFloat(v.serviceRate);
    if (!v.name) return toast('Restaurant name is required', 'error');
    if (!(tax >= 0 && tax <= 100) || !(service >= 0 && service <= 100)) return toast('Rates must be between 0 and 100', 'error');
    Object.assign(Store.settings, {
      name: v.name, address: v.address, phone: v.phone, currency: v.currency.replace(/[<>&"']/g, '') || '$',
      taxRate: tax, serviceRate: service, receiptFooter: v.receiptFooter, printKitchenTickets: v.printKitchenTickets,
    });
    Store.save();
    App.render();
    toast('Settings saved', 'ok');
  },

  addTable() {
    const input = this.root.querySelector('[data-role=new-table]');
    const name = input.value.trim();
    if (!name) return toast('Enter a table name', 'error');
    Store.data.tables.push({ id: uid('t_'), name, guestCode: guestCode() });
    Store.save();
    this.render(this.root);
  },

  renameTable(id) {
    const t = Store.table(id);
    const actions = {
      save: () => {
        const name = Modal.el().querySelector('[name=name]').value.trim();
        if (!name) return toast('Name is required', 'error');
        const cur = Store.table(id);
        if (cur) cur.name = name;
        Store.save();
        Modal.close();
        this.render(this.root);
      },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: 'Rename table',
      body: `<label class="field"><span>Name</span><input class="input" name="name" value="${esc(t.name)}" autofocus></label>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>',
      actions,
    });
  },

  deleteTable(id) {
    const t = Store.table(id);
    if (Store.openOrderForTable(id)) return toast(`${t.name} has an open order`, 'error');
    confirmDialog({
      title: `Delete ${t.name}?`,
      message: Store.server ? 'Its QR code will stop working.' : '',
      okLabel: 'Delete',
      danger: true,
      onOk: () => {
        Store.data.tables = Store.data.tables.filter(x => x.id !== id);
        Store.save();
        this.render(this.root);
      },
    });
  },

  // ----- QR codes for guest ordering -----
  qrSVG(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  },

  sheetHTML(base) {
    const name = Store.settings.name;
    return `<div class="qr-sheet">${Store.data.tables.map(t => {
      const url = `${base}/?table=${encodeURIComponent(t.guestCode)}`;
      return `
        <div class="qr-card">
          <div class="qr-brand">${esc(name)}</div>
          <div class="qr-code">${this.qrSVG(url)}</div>
          <div class="qr-table">${esc(t.name)}</div>
          <div class="qr-hint">Scan to see the menu and order</div>
          <div class="qr-url">${esc(url)}</div>
        </div>`;
    }).join('')}</div>`;
  },

  showQR() {
    const options = this.addresses();
    const render = base => {
      Modal.el().querySelector('[data-role=preview]').innerHTML = this.sheetHTML(base);
    };
    Modal.open({
      title: 'Table QR codes',
      wide: true,
      body: `
        <p class="muted small">Guests scan these on their own phones. Their phones must be on the restaurant Wi-Fi.
          If this PC's address changes, the codes stop working — reserve its IP address in your router.</p>
        <label class="field"><span>Address in the codes</span>
          <select class="input" name="base">${options.map(a => `<option>${esc(a)}</option>`).join('')}</select></label>
        <div data-role="preview" class="qr-preview"></div>`,
      footer: '<button class="btn" data-act="__close">Close</button><button class="btn primary" data-act="print">🖨️ Print</button>',
      actions: {
        __change: e => { if (e.target.name === 'base') render(e.target.value); },
        print: () => printLocal(this.sheetHTML(Modal.el().querySelector('[name=base]').value), true),
      },
    });
    render(options[0]);
  },

  async toggleStation(input) {
    input.disabled = true;
    try {
      if (input.checked) {
        await Station.enable();
        toast('This device will print for the other devices', 'ok');
      } else {
        await Station.disable();
        toast('Printer station turned off');
      }
    } catch (e) {
      input.checked = !input.checked;
      toast(e.message, 'error');
    }
    input.disabled = false;
  },

  // ----- backup -----
  async loadBackupStatus() {
    const box = this.root && this.root.querySelector('[data-role=backup-status]');
    if (!box) return;
    try {
      const st = await Sync.api('/api/backup');
      if (this.root.querySelector('[data-role=backup-status]') !== box) return;
      this.showBackupStatus(box, st);
    } catch (e) {
      box.innerHTML = `<div class="alert-box">⚠️ ${esc(e.message)}</div>`;
    }
  },

  showBackupStatus(box, st) {
    const age = f => (f.at ? `last copy ${timeAgo(f.at)}` : 'no copy yet');
    box.innerHTML = `
      ${st.safe ? '<div class="ok-box">✓ A recent copy is on a different disk or drive.</div>'
        : '<div class="alert-box">⚠️ All backups are on the disk of this PC itself. If the disk fails, the data and the backups are lost together. Add a USB drive or a cloud-synced folder below.</div>'}
      <ul class="plain backup-list">
        ${st.folders.map(f => `
          <li>
            <span><code>${esc(f.path)}</code><br><small class="muted">${f.kind === 'main' ? 'On this PC' : f.offDisk ? 'Different disk ✓' : 'Same disk as the data'} · ${f.count} cop${f.count === 1 ? 'y' : 'ies'} · ${age(f)}</small></span>
            ${f.error ? `<span class="pill void">${esc(f.error)}</span>` : f.stale ? '<span class="pill open">Old</span>' : '<span class="pill paid">OK</span>'}
          </li>`).join('')}
      </ul>`;
  },

  async backupNow() {
    try {
      const st = await Sync.api('/api/backup/run', { method: 'POST' });
      this.showBackupStatus(this.root.querySelector('[data-role=backup-status]'), st);
      toast('Backup saved', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  async backupFolders() {
    let current = [];
    try { current = (await Sync.api('/api/backup')).folders.filter(f => f.kind === 'extra').map(f => f.path); } catch (e) { return toast(e.message, 'error'); }
    const actions = {
      save: async () => {
        const dirs = [...Modal.el().querySelectorAll('[name=dir]')].map(i => i.value.trim()).filter(Boolean);
        try {
          const st = await Sync.api('/api/backup/folders', { method: 'POST', body: { dirs } });
          Modal.close();
          this.showBackupStatus(this.root.querySelector('[data-role=backup-status]'), st);
          toast('Backup folders saved', 'ok');
        } catch (e) {
          toast(e.message, 'error');
        }
      },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: 'Backup folders',
      body: `
        <p class="muted small">Type the full path of a folder on a USB drive or in a cloud-synced folder (OneDrive, Google Drive, Dropbox). A copy is saved there every day. The folder must already exist.</p>
        <label class="field"><span>Folder 1</span><input class="input" name="dir" value="${esc(current[0] || '')}" placeholder="e.g. E:&#92;POS-backups" autofocus></label>
        <label class="field"><span>Folder 2 (optional)</span><input class="input" name="dir" value="${esc(current[1] || '')}" placeholder="e.g. C:&#92;Users&#92;Me&#92;OneDrive&#92;POS-backups"></label>
        <p class="muted small">Leave a box empty to stop using it. If a USB drive is unplugged, the POS keeps trying and shows a warning here.</p>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save folders</button>',
      actions,
    });
  },

  async exportData() {
    if (!Store.server) {
      return downloadFile(`pos-backup-${isoDate(new Date())}.json`, JSON.stringify(Store.data, null, 2), 'application/json');
    }
    try {
      const res = await fetch('/api/export', { headers: { Authorization: 'Bearer ' + Sync.token } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
      downloadFile(`pos-backup-${isoDate(new Date())}.json`, await res.text(), 'application/json');
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  async resetData() {
    if (!Store.server) {
      Store.reset();
      App.user = null;
      App.go('login');
      return toast('Demo data restored');
    }
    try {
      await Sync.api('/api/reset', { method: 'POST' }); // every device reloads
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (e) { data = null; }
      if (!Store.isValid(data)) return toast('That file is not a valid POS backup', 'error');
      confirmDialog({
        title: 'Import this backup?',
        message: `It contains ${data.products.length} items, ${data.orders.length} orders and ${data.users.length} staff. All current data${Store.server ? ' on every device' : ' on this device'} will be replaced.`,
        okLabel: 'Import',
        danger: true,
        onOk: async () => {
          if (!Store.server) {
            Store.replace(data);
            App.user = null;
            App.go('login');
            return toast('Backup imported', 'ok');
          }
          try {
            await Sync.api('/api/import', { method: 'POST', body: data }); // every device reloads
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      });
    };
    reader.readAsText(file);
  },
};
