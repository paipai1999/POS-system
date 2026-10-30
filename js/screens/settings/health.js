'use strict';

// Settings → System health: what the machine running the POS is doing and anything the owner should look at.
Object.assign(Screens.settings, {
  healthHTML() {
    return `
      <section class="card">
        <h2>System health</h2>
        <div data-role="health" class="health"><p class="muted small">Checking…</p></div>
        <div class="stack"><button class="btn" data-act="health-refresh">${icon('repeat')} Check again</button></div>
      </section>`;
  },

  async loadHealth() {
    const box = this.root && this.root.querySelector('[data-role=health]');
    if (!box) return;
    try {
      const s = await Sync.api('/api/system');
      if (this.root.querySelector('[data-role=health]') !== box) return;
      this.showHealth(box, s);
      App.setHealth(s.warnings);
    } catch (e) {
      box.innerHTML = `<div class="alert-box">${icon('alert')} ${esc(e.message)}</div>`;
    }
  },

  showHealth(box, s) {
    const fact = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
    const warnings = s.warnings.length
      ? s.warnings.map(w => `<div class="alert-box ${w.level === 'error' ? 'danger' : ''}">${icon('alert')} ${esc(w.text)}</div>`).join('')
      : '<div class="ok-box">✓ Everything looks fine.</div>';
    box.innerHTML = `
      ${warnings}
      <dl class="facts">
        ${fact('Version', esc(s.version))}
        ${fact('Server running for', fmtDuration(s.uptimeMs))}
        ${fact('Data', `${fmtBytes(s.data.bytes)} · ${s.data.orders} orders · ${s.data.products} items · ${s.data.customers} customers · ${s.data.staff} staff`)}
        ${fact('Free disk space', s.disk ? `${fmtBytes(s.disk.free)} of ${fmtBytes(s.disk.total)}` : 'unknown')}
        ${fact('Last backup', s.lastBackupAt ? timeAgo(s.lastBackupAt) : 'none yet')}
        ${fact('Printer stations online', s.stations)}
        ${fact('Secure connection (HTTPS)', s.https ? 'On' : 'Off')}
        ${fact('Other devices use', s.addresses.length ? s.addresses.map(a => `<code>${esc((s.https ? 'https://' : 'http://') + a)}</code>`).join(' ') : 'no network address found')}
      </dl>`;
  },
});
