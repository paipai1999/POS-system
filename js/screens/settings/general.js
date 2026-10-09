'use strict';

// Settings: the restaurant's name and contact details, money format, tax, receipts and the ingredient-stock option.
Object.assign(Screens.settings, {
  generalHTML(s) {
    return `
      <h2>Restaurant &amp; receipts</h2>
      <label class="field"><span>Restaurant name</span><input class="input" name="name" value="${esc(s.name)}"></label>
      <label class="field"><span>Address</span><input class="input" name="address" value="${esc(s.address)}"></label>
      <label class="field"><span>Phone</span><input class="input" name="phone" value="${esc(s.phone)}"></label>
      <label class="field"><span>Money format</span>
        <select class="input" data-role="preset">
          <option value="">Custom (use the three boxes below)</option>
          <option value="usd">US dollar — $1,234.50</option>
          <option value="mmk">Myanmar kyat — 1,500 Ks</option>
        </select></label>
      <div class="grid-3">
        <label class="field"><span>Currency symbol</span><input class="input" name="currency" value="${esc(s.currency)}" maxlength="4"></label>
        <label class="field"><span>Decimals</span>
          <select class="input" name="decimals"><option value="2" ${decimalsOf(s) === 2 ? 'selected' : ''}>2 (1.50)</option><option value="0" ${decimalsOf(s) === 0 ? 'selected' : ''}>0 (1,500)</option></select></label>
        <label class="field"><span>Symbol position</span>
          <select class="input" name="currencyAfter"><option value="0" ${s.currencyAfter ? '' : 'selected'}>Before ($5)</option><option value="1" ${s.currencyAfter ? 'selected' : ''}>After (5 Ks)</option></select></label>
      </div>
      <p class="muted small">Changing the money format does not convert menu prices. Edit the prices under Menu &amp; Stock.</p>
      <div class="grid-2">
        <label class="field"><span>Tax %</span><input class="input" name="taxRate" type="number" min="0" max="100" step="0.01" value="${s.taxRate}"></label>
        <label class="field"><span>Service charge %</span><input class="input" name="serviceRate" type="number" min="0" max="100" step="0.01" value="${s.serviceRate}"></label>
      </div>
      <label class="field"><span>Receipt footer</span><input class="input" name="receiptFooter" value="${esc(s.receiptFooter)}"></label>
      <label class="check"><input type="checkbox" name="printKitchenTickets" ${s.printKitchenTickets ? 'checked' : ''}> Also print a kitchen ticket when items are sent</label>
      <label class="field"><span>When an ingredient runs out</span>
        <select class="input" name="ingredientStock">
          ${[['off', 'Do nothing'], ['warn', 'Warn on the dish (it can still be sold)'], ['block', 'Stop selling the dishes that need it']].map(([k, label]) =>
            `<option value="${k}" ${ingredientStockMode(s) === k ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>`;
  },

  // Checks this part of the form and returns the settings it sets (throws an Error with a message for the person).
  readGeneral(v) {
    const tax = parseFloat(v.taxRate);
    const service = parseFloat(v.serviceRate);
    if (!v.name) throw new Error('Restaurant name is required');
    if (!(tax >= 0 && tax <= 100) || !(service >= 0 && service <= 100)) throw new Error('Rates must be between 0 and 100');
    return {
      name: v.name, address: v.address, phone: v.phone, currency: v.currency.replace(/[<>&"'`]/g, '').trim() || '$',
      decimals: v.decimals === '0' ? 0 : 2, currencyAfter: v.currencyAfter === '1',
      ingredientStock: v.ingredientStock,
      taxRate: tax, serviceRate: service, receiptFooter: v.receiptFooter, printKitchenTickets: v.printKitchenTickets,
    };
  }
});
