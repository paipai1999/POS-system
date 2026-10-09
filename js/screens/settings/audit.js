'use strict';

// Settings: the activity log (who changed what).
Object.assign(Screens.settings, {
  async showAudit() {
    const state = { rows: [], more: false, q: '' };
    const rowsHTML = () => {
      const q = state.q.trim().toLowerCase();
      const rows = state.rows.filter(r => !q || `${r.user} ${r.action} ${r.target} ${r.detail}`.toLowerCase().includes(q));
      if (!rows.length) return '<tr><td colspan="4" class="empty">Nothing recorded</td></tr>';
      return rows.map(r => `
        <tr>
          <td class="nowrap">${fmtDateTime(r.at)}</td>
          <td>${esc(r.user || '—')}</td>
          <td><b>${esc(r.action)}</b>${r.target ? ` · ${esc(r.target)}` : ''}</td>
          <td class="muted small wrap-cell">${esc(r.detail)}</td>
        </tr>`).join('');
    };
    const refresh = () => {
      const m = Modal.el();
      if (!m) return;
      m.querySelector('tbody').innerHTML = rowsHTML();
      m.querySelector('[data-act=older]').hidden = !state.more;
    };
    const load = async before => {
      try {
        const r = await Sync.api('/api/audit?limit=200' + (before ? '&before=' + before : ''));
        state.rows.push(...r.rows);
        state.more = r.more;
        refresh();
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    Modal.open({
      title: 'Activity log',
      wide: true,
      body: `
        <input class="input" type="search" data-role="q" placeholder="Filter, e.g. price, refund, Maya…">
        <div class="table-wrap audit-wrap"><table class="data compact"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody><tr><td colspan="4" class="empty">Loading…</td></tr></tbody></table></div>`,
      footer: '<button class="btn" data-act="older" hidden>Load older entries</button><span class="spacer"></span><button class="btn primary" data-act="__close">Close</button>',
      actions: {
        older: () => load(state.rows[state.rows.length - 1].id),
        __input: e => { if (e.target.dataset.role === 'q') { state.q = e.target.value; refresh(); } },
      },
    });
    await load();
  },

  auditHTML() {
    return `
      <section class="card">
                <h2>Activity log</h2>
                <p class="muted small">A record of who changed prices, stock, staff, settings and tax, who voided, refunded or discounted an order, and who signed in or downloaded the data. It cannot be edited and is kept for 13 months.</p>
                <button class="btn" data-act="audit">📜 View activity log</button>
              </section>`;
  }
});
