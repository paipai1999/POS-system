'use strict';

// Finance tab: daily close - the day's figures, frozen. After a day is closed nothing dated in it can be added or voided
// (an admin can reopen it). The server works out the figures itself when the day is closed.
(() => {
  const who = id => (Store.user(id) || {}).name || '';

  // The report as rows: [label, value, kind]. `s` is a day summary (see Finance.daySummary).
  function rowsOf(s) {
    const m = s.byMethod;
    return [
      ['Bills paid', s.orders, 'count'],
      ['Gross sales', s.grossSales, 'line'],
      ['Discounts', -s.discounts, 'sub'],
      ['Refunds made today', -s.refunds, 'sub'],
      ['Service charge', s.service, 'sub'],
      ['Revenue', s.revenue, 'total'],
      ['Cost of goods', -s.cogs, 'sub'],
      ['Gross profit', s.grossProfit, 'total'],
      ['Expenses', -s.expenses, 'sub'],
      ['Net profit', s.netProfit, 'grand'],
      ['Received in cash', m.cash, 'line'],
      ['Received by card', m.card, 'line'],
      ['Received by bank / wallet', m.other, 'line'],
      ['Sold on account', s.onAccount || 0, 'line'],
      ['Customers paid their accounts', s.customerPaid || 0, 'line'],
      ['Tax collected', s.tax, 'line'],
      ['Tips received', s.tips, 'line'],
      ['Cash drawer: should be', s.shifts.expected, 'line'],
      ['Cash drawer: counted', s.shifts.counted, 'line'],
      ['Cash drawer: difference', s.shifts.difference, s.shifts.difference ? 'bad' : 'line'],
      ['Voided bills', s.voids.count, 'count'],
      ['Voided bills: value', s.voids.amount, 'line'],
    ];
  }

  function tableHTML(s) {
    return `
      <table class="data statement">
        <tbody>${rowsOf(s).map(([label, value, kind]) => `
          <tr class="st-${kind}"><td>${label}</td><td class="num">${kind === 'count' ? value : money(value)}</td></tr>`).join('')}
        </tbody>
      </table>`;
  }

  // The printable report (also shown in a dialog).
  function reportHTML(key, s, close) {
    return `
      <div class="z-report">
        <h2>${esc(Store.settings.name)}</h2>
        <p><b>Daily close</b> · ${esc(Screens.finance.dayText(Finance.dayBounds(key)[0]))}</p>
        ${close ? `<p class="muted small"><span>Closed by</span> ${esc(who(close.closedBy))} · ${fmtDateTime(close.closedAt)}${close.note ? ` · ${esc(close.note)}` : ''}</p>` : ''}
        ${tableHTML(s)}
        ${s.expenseRows && s.expenseRows.length ? `
          <h3>Expenses</h3>
          <table class="data compact"><tbody>${s.expenseRows.map(r => `<tr><td>${esc(r.category)}</td><td class="num">${money(r.amount)}</td></tr>`).join('')}</tbody></table>` : ''}
        ${s.openBills ? `<p class="small"><b>${s.openBills}</b> <span>bills were still open when the day was closed.</span></p>` : ''}
      </div>`;
  }

  function showReport(f, key, close) {
    Modal.open({
      title: 'Daily close',
      wide: true,
      body: reportHTML(key, close.summary, close),
      footer: '<button class="btn" data-act="__close">Close</button><button class="btn primary" data-act="print">🖨️ Print</button>',
      actions: { print: () => printLocal(reportHTML(key, close.summary, close), true) },
    });
  }

  function html(f) {
    const key = f.state.day;
    const [a] = Finance.dayBounds(key);
    const close = Store.data.dayCloses.find(c => c.id === key);
    const summary = close ? close.summary : Finance.daySummary(key, Store.data, Store.settings);
    const openShift = Store.data.shifts.some(s => !s.closedAt && Finance.dayKey(s.openedAt) === key);
    const future = a > Date.now();
    const recent = [...Store.data.dayCloses].sort((x, y) => (y.id > x.id ? 1 : -1)).slice(0, 30);
    return `
      <div class="toolbar">
        <label class="field inline"><span>Day</span><input class="input" type="date" data-role="day" value="${key}" max="${isoDate(new Date())}"></label>
        ${close
          ? `<span class="pill paid">🔒 <span>Closed</span></span>
             <button class="btn" data-act="view-close">View report</button>
             ${App.can('settings') ? '<button class="btn danger" data-act="reopen">Reopen this day</button>' : ''}`
          : `<span class="pill open"><span>Open</span></span>
             <button class="btn primary" data-act="close-day" ${openShift || future ? 'disabled' : ''}>🔒 Close this day…</button>`}
      </div>
      ${close ? `<p class="muted small"><span>Closed by</span> ${esc(who(close.closedBy))} · ${fmtDateTime(close.closedAt)}${close.note ? ` · ${esc(close.note)}` : ''}</p>` : ''}
      ${!close && openShift ? '<p class="alert-box">⚠️ <span>A shift from this day is still open. Close the cash drawer first.</span></p>' : ''}
      ${!close ? '<p class="muted small">These figures can still change until the day is closed. Closing freezes them: nothing dated in this day can be added or voided afterwards.</p>' : ''}
      <div class="table-wrap">${tableHTML(summary)}</div>
      <h2 class="section-title">Closed days</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Day</th><th class="num">Revenue</th><th class="num">Net profit</th><th>Closed by</th><th></th></tr></thead>
          <tbody>${recent.map(c => `
            <tr><td>${esc(f.dayText(Finance.dayBounds(c.id)[0]))}</td><td class="num">${money(c.summary.revenue)}</td><td class="num">${money(c.summary.netProfit)}</td>
              <td>${esc(who(c.closedBy))}</td><td><button class="btn small" data-act="open-day" data-day="${c.id}">View</button></td></tr>`).join('')
            || '<tr><td colspan="5" class="empty">No day has been closed yet</td></tr>'}
          </tbody>
        </table>
      </div>`;
  }

  function csv() {
    const rows = [['Day', 'Bills', 'Gross sales', 'Discounts', 'Refunds', 'Revenue', 'Tax', 'Tips', 'Cash', 'Card', 'Bank / wallet', 'Cost of goods', 'Expenses', 'Net profit', 'Drawer difference', 'Closed by', 'Note']];
    for (const c of [...Store.data.dayCloses].sort((x, y) => (x.id > y.id ? 1 : -1))) {
      const s = c.summary;
      rows.push([c.id, s.orders, s.grossSales, s.discounts, s.refunds, s.revenue, s.tax, s.tips, s.byMethod.cash, s.byMethod.card, s.byMethod.other, s.cogs, s.expenses, s.netProfit, s.shifts.difference, who(c.closedBy), c.note || '']);
    }
    return rows;
  }

  async function settle() {
    if (Store.server) { try { await Sync.flush(); } catch (e) { /* the sync indicator shows problems */ } }
  }

  Screens.finance.tabs.close = {
    label: 'Daily close', uses: 'day', html, csv, filename: 'daily-closes', reportHTML,
    changes: { day: (f, input) => { if (input.value) { f.state.day = input.value; f.render(f.root); } } },
    actions: {
      'view-close': f => showReport(f, f.state.day, Store.data.dayCloses.find(c => c.id === f.state.day)),
      'open-day': (f, t) => { f.state.day = t.dataset.day; f.render(f.root); },
      'close-day': f => {
        const key = f.state.day;
        const actions = {
          confirm: async () => {
            try { Store.closeDay(key, Modal.el().querySelector('[name=note]').value); } catch (e) { return toast(e.message, 'error'); }
            Modal.close();
            await settle();
            const done = Store.data.dayCloses.find(c => c.id === key);
            toast(done ? 'Day closed' : 'The day could not be closed', done ? 'ok' : 'error');
            f.render(f.root);
          },
        };
        actions.__enter = actions.confirm;
        Modal.open({
          title: `Close ${f.dayText(Finance.dayBounds(key)[0])}?`,
          body: `
            <p>The figures of this day are frozen. Nothing dated in it can be added or voided afterwards; only an admin can reopen it.</p>
            ${Store.openOrders().length ? `<p class="alert-box"><b>${Store.openOrders().length}</b> <span>bills are still open. They are not sales yet and carry over.</span></p>` : ''}
            <label class="field"><span>Note (optional)</span><input class="input" name="note" maxlength="300" autofocus></label>`,
          footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="confirm">Close the day</button>',
          actions,
        });
      },
      reopen: f => confirmDialog({
        title: 'Reopen this day?', message: 'Records dated in this day can be added and voided again. The activity log keeps a note of it.', okLabel: 'Reopen', danger: true,
        onOk: async () => { Store.reopenDay(f.state.day); await settle(); f.render(f.root); },
      }),
    },
  };
})();
