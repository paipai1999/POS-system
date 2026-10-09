'use strict';

// Settings: backups, restoring a backup, and resetting to demo data.
Object.assign(Screens.settings, {
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

  backupHTML(server) {
    return `
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
              </section>`;
  }
});
