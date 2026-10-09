'use strict';

// Customers: buying on account. What a customer owes, receiving their payments (or writing a debt off), and their statement.
// A bill is put on account at checkout (see checkout/); the credit limit is set in the customer's details by a manager.
Object.assign(Screens.customers, {
  // What a customer owes, for the list: the amount (red when over the limit), the limit, or "in credit".
  owesHTML(c) {
    const owing = c.owing || 0;
    if (owing < 0) return `<span class="muted"><span>In credit</span> ${money(-owing)}</span>`;
    if (!owing) return c.creditLimit > 0 ? `<span class="muted small"><span>Limit</span> ${money(c.creditLimit)}</span>` : '<span class="muted">—</span>';
    const over = c.creditLimit > 0 && owing > c.creditLimit + 0.005;
    return `<b class="${over ? 'low-stock' : ''}">${money(owing)}</b>${c.creditLimit > 0 ? ` <span class="muted small">/ ${money(c.creditLimit)}</span>` : ''}`;
  },

  // A customer pays some or all of what they owe. `onDone` runs after it was saved.
  receivePayment(id, onDone = () => {}) {
    const c = Store.customer(id);
    if (!c) return;
    const actions = {
      save: () => {
        const v = formValues(Modal.el());
        try { Store.addCustomerPayment({ customerId: id, amount: parseFloat(v.amount), method: v.method, note: v.note }); } catch (e) { return toast(e.message, 'error'); }
        Modal.close();
        toast('Payment recorded', 'ok');
        onDone();
      },
      writeoff: () => requireManager(`Write off what ${c.name} owes.`, () => {
        const amount = parseFloat(Modal.el() ? formValues(Modal.el()).amount : '') || c.owing;
        confirmDialog({
          title: `Write off ${money(amount)}?`,
          message: `${c.name} will no longer owe this. It is counted as an expense (bad debt).`,
          okLabel: 'Write off',
          danger: true,
          onOk: () => {
            try { Store.addCustomerPayment({ customerId: id, amount, method: 'writeoff', note: 'Written off' }); } catch (e) { return toast(e.message, 'error'); }
            toast('Written off', 'ok');
            onDone();
          },
        });
      }),
    };
    actions.__enter = actions.save;
    Modal.open({
      title: `Payment from ${c.name}`,
      body: `
        <p class="muted"><span>Owes now</span> <b>${money(c.owing || 0)}</b></p>
        <div class="grid-2">
          <label class="field"><span>Amount received</span><input class="input big-input" name="amount" type="number" min="0" step="${moneyStep()}" inputmode="decimal" value="${c.owing > 0 ? c.owing : ''}" autofocus></label>
          <label class="field"><span>Paid with</span>
            <select class="input" name="method"><option value="cash">Cash</option><option value="card">Card</option><option value="other">Bank transfer / mobile wallet</option></select></label>
        </div>
        <label class="field"><span>Note (optional)</span><input class="input" name="note" maxlength="200"></label>
        <p class="muted small">Cash goes into the drawer of the open shift.</p>`,
      footer: `${App.can('manage') ? '<button class="btn danger" data-act="writeoff">Write off…</button><span class="spacer"></span>' : ''}
        <button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Record payment</button>`,
      actions,
    });
  },

  // The customer's account: every bill put on account and every payment, with the balance after each.
  statement(id) {
    const c = Store.customer(id);
    if (!c) return;
    // In server mode the bills and payments since the customer was added are fetched first, so the account is complete.
    Sync.loadHistory(c.createdAt || 0).then(() => this.showStatement(id)).catch(e => toast(e.message, 'error'));
  },

  showStatement(id) {
    const c = Store.customer(id);
    if (!c) return;
    const st = Finance.statement(id, Store.data, Store.settings, Sync.historySince());
    const label = e => ({
      bill: 'Bill on account', refund: 'Bill refunded', earlier: 'Earlier balance', writeoff: 'Written off',
      payment: { cash: 'Payment in cash', card: 'Payment by card', other: 'Payment by bank / wallet' }[e.method] || 'Payment',
    })[e.kind];   // (each label is its own element so it can be translated)
    const html = () => `
      <div class="z-report">
        <h2>${esc(Store.settings.name)}</h2>
        <p><b>${esc(c.name)}</b>${c.phone ? ` · ${esc(c.phone)}` : ''}</p>
        <table class="data compact">
          <thead><tr><th>Date</th><th></th><th class="num">Amount</th><th class="num">Balance</th></tr></thead>
          <tbody>${st.entries.map(e => `
            <tr><td>${e.kind === 'earlier' ? '' : fmtDateTime(e.date)}</td><td class="wrap"><span>${label(e)}</span>${e.ref ? ` ${esc(e.ref)}` : ''}</td>
              <td class="num">${money(e.amount)}</td><td class="num">${money(e.balance)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing on this account yet</td></tr>'}
          </tbody>
        </table>
        <p class="small"><b><span>${st.owing >= 0 ? 'Owes' : 'In credit'}</span> ${money(Math.abs(st.owing))}</b>${c.creditLimit > 0 ? ` · <span>credit limit</span> ${money(c.creditLimit)}` : ''}</p>
      </div>`;
    Modal.open({
      title: `Statement · ${c.name}`,
      wide: true,
      body: html(),
      footer: `<button class="btn" data-act="__close">Close</button><span class="spacer"></span>
        <button class="btn" data-act="print">🖨️ Print</button>
        ${st.owing > 0 ? '<button class="btn primary" data-act="receive">Receive payment</button>' : ''}`,
      actions: {
        print: () => printLocal(html(), true),
        receive: () => this.receivePayment(id, () => { if (App.screen === 'customers') this.render(this.root); else App.refreshScreen(); }),
      },
    });
  },
});
