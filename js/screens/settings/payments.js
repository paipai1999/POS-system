'use strict';

// Settings: the names offered for "Other" payments (mobile wallets, bank transfer…).
const PAY_NAME_SUGGESTIONS = ['KBZPay', 'Wave Pay', 'AYA Pay', 'CB Pay', 'UAB Pay', 'Bank transfer'];

Object.assign(Screens.settings, {
  paymentsHTML(s) {
    const names = Array.isArray(s.payNames) ? s.payNames : [];
    const quick = PAY_NAME_SUGGESTIONS.filter(n => !names.some(x => x.toLowerCase() === n.toLowerCase()));
    return `
      <section class="card" data-role="paynames">
        <h2>Payment names</h2>
        <p class="muted small">Names for the “Other” payment method: mobile wallets, bank transfer… The cashier taps one at checkout. It shows on the receipt and in the reports, and the money still counts as bank / other.</p>
        <ul class="plain">
          ${names.map(n => `<li class="list-row"><span>${esc(n)}</span><button class="btn small danger" data-act="pay-del" data-name="${esc(n)}">Remove</button></li>`).join('')
            || '<li class="muted small">No names yet: Other payments are recorded without a name.</li>'}
        </ul>
        <div class="inline-add">
          <input class="input" data-role="new-payname" placeholder="e.g. KBZPay" maxlength="${PAY_NAME_LENGTH}">
          <button class="btn primary" data-act="pay-add">Add</button>
        </div>
        ${quick.length ? `<div class="chips wrap suggestions"><span class="muted small">Quick add:</span> ${quick.map(n => `<button class="chip" data-act="pay-add" data-name="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>` : ''}
      </section>`;
  },

  addPayName(raw) {
    const name = String(raw || '').replace(/[<>&"'`]/g, '').trim().slice(0, PAY_NAME_LENGTH);
    const names = Array.isArray(Store.settings.payNames) ? Store.settings.payNames : [];
    if (!name) return toast('Type a name first', 'error');
    if (PAY_NAMES_RESERVED.includes(name.toLowerCase())) return toast(`"${name}" is already a payment method. Choose another name.`, 'error');
    if (names.some(n => n.toLowerCase() === name.toLowerCase())) return toast('That name is already in the list', 'error');
    if (names.length >= PAY_NAMES_MAX) return toast(`At most ${PAY_NAMES_MAX} payment names`, 'error');
    Store.settings.payNames = [...names, name];
    Store.save();
    App.render();
    toast('Payment name added', 'ok');
  },

  removePayName(name) {
    Store.settings.payNames = (Store.settings.payNames || []).filter(n => n !== name);
    Store.save();
    App.render();
  },
});
