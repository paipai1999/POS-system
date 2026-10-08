'use strict';

// Cash drawer: start a shift with the cash in the drawer, close it by counting. The expected amount is
// opening cash + cash taken (bills and tips) − cash paid back in refunds; the difference is recorded.
Screens.drawer = {
  perm: 'checkout',
  live: ['shifts', 'orders', 'users'],
  root: null,

  render(root) {
    this.root = root;
    const open = Store.openShift();
    const past = Store.data.shifts.filter(s => s.closedAt && s.countedCash !== undefined).sort((a, b) => b.closedAt - a.closedAt).slice(0, 30);
    const who = id => { const u = Store.user(id); return u ? u.name : '—'; };
    const dec = decimalsOf(Store.settings);
    let body;
    if (open) {
      const sums = computeShift(open, Store.data.orders, dec);
      body = `
        <section class="card">
          <h2>Shift open</h2>
          <p class="muted">Started ${fmtDateTime(open.openedAt)} by ${esc(who(open.openedBy))}</p>
          <div class="drawer-grid">
            <div class="card stat"><div class="label">Cash at the start</div><div class="value">${money(open.openingFloat)}</div></div>
            <div class="card stat"><div class="label">Cash taken</div><div class="value">${money(sums.cashIn)}</div><div class="muted small">${sums.orders} bill${sums.orders === 1 ? '' : 's'}, tips included</div></div>
            <div class="card stat"><div class="label">Cash paid back (refunds)</div><div class="value">${money(sums.cashOut)}</div></div>
            <div class="card stat"><div class="label">Should be in the drawer</div><div class="value">${money(sums.expected)}</div></div>
          </div>
          <button class="btn primary big" data-act="close-shift">Close shift and count the drawer…</button>
        </section>`;
    } else {
      body = `
        <section class="card">
          <h2>Start a shift</h2>
          <p class="muted">Count the cash in the drawer and enter it. At the end of the shift you count again and the POS shows any difference.</p>
          <label class="field"><span>Cash in the drawer now</span>
            <input class="input big-input" name="float" type="number" min="0" step="${moneyStep()}" inputmode="decimal" placeholder="0" autofocus></label>
          <button class="btn primary big" data-act="start-shift">Start shift</button>
        </section>`;
    }
    root.innerHTML = `
      <div class="page-head"><h1>Cash drawer</h1></div>
      ${body}
      <h2 class="section-title">Past shifts</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Closed</th><th>By</th><th class="num">Bills</th><th class="num">Sales</th><th class="num">Tips</th><th class="num">Expected</th><th class="num">Counted</th><th class="num">Difference</th><th>Note</th></tr></thead>
          <tbody>${past.map(s => `
            <tr>
              <td>${fmtDateTime(s.closedAt)}</td>
              <td>${esc(who(s.closedBy))}</td>
              <td class="num">${s.orders ?? ''}</td>
              <td class="num">${money(s.sales || 0)}</td>
              <td class="num">${money(s.tips || 0)}</td>
              <td class="num">${money(s.expectedCash)}</td>
              <td class="num">${money(s.countedCash)}</td>
              <td class="num ${s.difference ? 'diff-bad' : 'diff-ok'}">${s.difference > 0 ? '+' : ''}${money(s.difference || 0)}</td>
              <td class="muted small wrap-cell">${esc(s.note || '')}</td>
            </tr>`).join('') || '<tr><td colspan="9" class="empty">No shifts closed yet</td></tr>'}
          </tbody>
        </table>
      </div>`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      if (t.dataset.act === 'start-shift') this.start(root);
      else if (t.dataset.act === 'close-shift') this.closeDialog(open);
    };
    root.onkeydown = e => { if (e.key === 'Enter' && e.target.name === 'float') this.start(root); };
  },

  start(root) {
    const value = parseFloat(root.querySelector('[name=float]').value);
    if (!(value >= 0)) return toast('Enter the cash in the drawer to start the shift', 'error');
    if (Store.openShift()) return toast('A shift is already open', 'error');
    Store.startShift(value);
    toast('Shift started', 'ok');
    this.render(root);
  },

  closeDialog(shift) {
    const dec = decimalsOf(Store.settings);
    const expected = () => computeShift(shift, Store.data.orders, dec).expected;
    const refresh = () => {
      const m = Modal.el();
      const counted = m.querySelector('[name=counted]').value;
      const box = m.querySelector('[data-role=diff]');
      if (counted === '') { box.className = 'change'; box.innerHTML = ''; return; }
      const diff = rmoney(parseFloat(counted) - expected());
      box.className = 'change' + (diff !== 0 ? ' short' : '');
      box.innerHTML = diff === 0 ? 'The drawer matches ✓' : diff < 0 ? `Short by <span>${money(-diff)}</span>` : `Over by <span>${money(diff)}</span>`;
    };
    const actions = {
      __input: e => { if (e.target.name === 'counted') refresh(); },
      confirm: async () => {
        const m = Modal.el();
        const counted = parseFloat(m.querySelector('[name=counted]').value);
        if (!(counted >= 0)) return toast('Enter the cash you counted', 'error');
        const note = m.querySelector('[name=note]').value.trim();
        Store.closeShift(shift, counted, note);
        Modal.close();
        if (Store.server) { try { await Sync.flush(); } catch (e) { /* the sync indicator shows problems */ } }
        const done = Store.data.shifts.find(s => s.id === shift.id);
        if (done && done.difference !== undefined) toast(done.difference === 0 ? 'Shift closed – the drawer matches' : `Shift closed – difference ${money(done.difference)}`, done.difference === 0 ? 'ok' : 'error');
        this.render(this.root);
      },
    };
    actions.__enter = actions.confirm;
    Modal.open({
      title: 'Close shift',
      body: `
        <p class="muted">Count all the cash in the drawer, including the opening cash, and enter the total.</p>
        <label class="field"><span>Cash counted</span>
          <input class="input big-input" name="counted" type="number" min="0" step="${moneyStep()}" inputmode="decimal" autofocus></label>
        <div class="change" data-role="diff"></div>
        <label class="field spaced"><span>Note (optional)</span><input class="input" name="note" maxlength="300" placeholder="e.g. paid the delivery man 20"></label>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="confirm">Close shift</button>',
      actions,
    });
  },
};
