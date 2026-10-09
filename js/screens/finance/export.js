'use strict';

// Finance: CSV files for the accountant (one tab, or all statements at once) and printing the tab that is showing.
// A CSV gets a byte-order mark when downloaded (see downloadFile), so Excel shows Myanmar text correctly.
Object.assign(Screens.finance, {
  // Rows (arrays of cells) as CSV text. Numbers stay numbers; anything with a comma, quote or line break is quoted.
  csvText(rows) {
    const cell = v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return rows.map(r => r.map(cell).join(',')).join('\n');
  },

  // "2026-10-01_to_2026-10-09", or just a date for a tab that is about one moment or one day.
  fileSuffix() {
    const tab = this.tab();
    if (tab.uses === 'now') return isoDate(new Date());
    if (tab.uses === 'day') return this.state.day;
    const [a, b] = this.bounds();
    return `${isoDate(new Date(a))}_to_${isoDate(new Date(b - 1))}`;
  },

  exportCSV() {
    const tab = this.tab();
    if (!tab.csv) return;
    downloadFile(`${tab.filename}_${this.fileSuffix()}.csv`, this.csvText(tab.csv(this)), 'text/csv');
  },

  // Purchases and supplier payments of the period (the other statements come from their tabs).
  purchaseRows() {
    const [a, b] = this.bounds();
    const rows = [['Date', 'Supplier', 'Items', 'Total', 'Tax included', 'Paid now', 'Paid with', 'Status']];
    for (const p of Store.data.purchases.filter(x => x.date >= a && x.date < b).sort((x, y) => x.date - y.date)) {
      rows.push([isoDate(new Date(p.date)), p.supplier || '', p.lines.map(l => `${l.qty} ${l.unit || ''} ${l.name || ''}`.trim()).join('; '), p.total, p.taxAmount || 0, p.paid ?? p.total, p.payMethod || '', p.status]);
    }
    return rows;
  },

  supplierPaymentRows() {
    const [a, b] = this.bounds();
    const rows = [['Date', 'Supplier', 'Amount', 'Paid with', 'Note', 'Status']];
    for (const p of Store.data.supplierPayments.filter(x => x.date >= a && x.date < b).sort((x, y) => x.date - y.date)) {
      rows.push([isoDate(new Date(p.date)), p.supplierName || '', p.amount, p.method, p.note || '', p.status]);
    }
    return rows;
  },

  // Every statement for the chosen period as separate files (the browser may ask once to allow several downloads).
  exportPack() {
    const [a, b] = this.bounds();
    const suffix = `${isoDate(new Date(a))}_to_${isoDate(new Date(b - 1))}`;
    const saved = this.state.tab;
    const files = [];
    for (const id of ['pl', 'cash', 'tax', 'expenses', 'controls']) {
      this.state.tab = id;
      files.push([`${this.tabs[id].filename}_${suffix}.csv`, this.csvText(this.tabs[id].csv(this))]);
    }
    this.state.tab = saved;
    files.push([`purchases_${suffix}.csv`, this.csvText(this.purchaseRows())], [`supplier-payments_${suffix}.csv`, this.csvText(this.supplierPaymentRows())]);
    files.forEach(([name, text], i) => setTimeout(() => downloadFile(name, text, 'text/csv'), i * 250));
    toast(`${files.length} files`, 'ok');
  },

  // Prints the statement on screen without its buttons and filters.
  printStatement() {
    const clone = this.root.querySelector('[data-role=statement]').cloneNode(true);
    clone.querySelectorAll('.toolbar, button, select, input, .switch').forEach(n => n.remove());
    const tab = this.tab();
    const period = tab.uses === 'period' ? this.periodLabel() : tab.uses === 'day' ? this.dayText(Finance.dayBounds(this.state.day)[0]) : this.dayText(Date.now());
    printLocal(`<div class="print-statement"><h2>${esc(Store.settings.name)}</h2><p><b>${esc(tab.label)}</b> · ${esc(period)}</p>${clone.innerHTML}</div>`, true);
  },
});
