'use strict';

// Settings: finance setup for the financial statements - the cash and bank balances on a start date, and the list of
// expense categories. (The statements themselves are in the Finance screen.)
Object.assign(Screens.settings, {
  financeHTML(s) {
    const f = Finance.financeOf(s);
    return `
      <section class="card" data-role="finance">
        <h2>Finance setup</h2>
        <p class="muted small">Used by the financial statements (Finance). Enter the cash and the bank balance you had on the date below; the financial position adds every movement recorded after that date.</p>
        <div class="grid-3">
          <label class="field"><span>Balances as of</span><input class="input" type="date" name="startDate" value="${f.startDate ? isoDate(new Date(f.startDate)) : ''}"></label>
          <label class="field"><span>Cash on hand</span><input class="input" name="openingCash" type="number" step="${moneyStep()}" inputmode="decimal" value="${f.openingCash}"></label>
          <label class="field"><span>Bank / wallet balance</span><input class="input" name="openingBank" type="number" step="${moneyStep()}" inputmode="decimal" value="${f.openingBank}"></label>
        </div>
        <label class="field"><span>Expense categories (one per line)</span><textarea class="input" name="categories" rows="6">${esc(f.categories.join('\n'))}</textarea></label>
        <button class="btn primary" data-act="save-finance">Save finance setup</button>
      </section>`;
  },

  saveFinance() {
    const v = formValues(this.root.querySelector('[data-role=finance]'));
    const cash = parseFloat(v.openingCash) || 0, bank = parseFloat(v.openingBank) || 0;
    let startDate = 0;
    if (v.startDate) {
      const [y, m, d] = v.startDate.split('-').map(Number);
      startDate = new Date(y, m - 1, d).getTime();
    } else if (cash || bank) {
      return toast('Choose the date these balances are for', 'error');
    }
    if (startDate > Date.now()) return toast('The date cannot be in the future', 'error');
    const categories = [...new Set(String(v.categories).split('\n').map(c => c.trim().slice(0, 30)).filter(Boolean))];
    if (categories.length > 40) return toast('At most 40 expense categories', 'error');
    Store.settings.finance = { openingCash: rmoney(cash), openingBank: rmoney(bank), startDate, categories };
    Store.save();
    toast('Finance setup saved', 'ok');
  },
});
