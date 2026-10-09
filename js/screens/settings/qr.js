'use strict';

// Settings: QR codes for guest ordering, and the printer station.
Object.assign(Screens.settings, {
  qrSVG(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  },

  sheetHTML(base) {
    const name = Store.settings.name;
    return `<div class="qr-sheet">${Store.data.tables.map(t => {
      const url = `${base}/?table=${encodeURIComponent(t.guestCode)}`;
      return `
        <div class="qr-card">
          <div class="qr-brand">${esc(name)}</div>
          <div class="qr-code">${this.qrSVG(url)}</div>
          <div class="qr-table">${esc(t.name)}</div>
          <div class="qr-hint">Scan to see the menu and order</div>
          <div class="qr-url">${esc(url)}</div>
        </div>`;
    }).join('')}</div>`;
  },

  showQR() {
    const options = this.addresses();
    const render = base => {
      Modal.el().querySelector('[data-role=preview]').innerHTML = this.sheetHTML(base);
    };
    Modal.open({
      title: 'Table QR codes',
      wide: true,
      body: `
        <p class="muted small">Guests scan these on their own phones. Their phones must be on the restaurant Wi-Fi.
          If this PC's address changes, the codes stop working — reserve its IP address in your router.</p>
        <label class="field"><span>Address in the codes</span>
          <select class="input" name="base">${options.map(a => `<option>${esc(a)}</option>`).join('')}</select></label>
        <div data-role="preview" class="qr-preview"></div>`,
      footer: '<button class="btn" data-act="__close">Close</button><button class="btn primary" data-act="print">🖨️ Print</button>',
      actions: {
        __change: e => { if (e.target.name === 'base') render(e.target.value); },
        print: () => printLocal(this.sheetHTML(Modal.el().querySelector('[name=base]').value), true),
      },
    });
    render(options[0]);
  },

  async toggleStation(input) {
    input.disabled = true;
    try {
      if (input.checked) {
        await Station.enable();
        toast('This device will print for the other devices', 'ok');
      } else {
        await Station.disable();
        toast('Printer station turned off');
      }
    } catch (e) {
      input.checked = !input.checked;
      toast(e.message, 'error');
    }
    input.disabled = false;
  },

  deviceHTML() {
    return `
      <section class="card">
                <h2>This device</h2>
                <p class="muted small">Open the POS on other phones and tablets on the same Wi-Fi:</p>
                <div class="address-list">${this.addresses().map(a => `<code>${esc(a)}</code>`).join('')}</div>
                <label class="check spaced"><input type="checkbox" data-role="station" ${Station.active ? 'checked' : ''}> This device is the printer station</label>
                <p class="muted small">Bills, receipts and kitchen tickets from waiters' phones print here. ${Sync.stations ? `<b>${Sync.stations} station${Sync.stations > 1 ? 's' : ''} online.</b>` : 'No station is online, so each device prints for itself.'}</p>
              </section>`;
  },

  printingHTML(server) {
    return `
      <section class="card">
                <h2>Printing</h2>
                <p class="muted small">Print a test page after connecting a printer: it checks the paper width, the paper cut and Myanmar text. In the print window choose the receipt printer, paper size 80 mm and margins "None".</p>
                <div class="stack">
                  <button class="btn" data-act="test-print-here">🖨️ Print test page on this device</button>
                  ${server ? `<button class="btn" data-act="test-print-station" ${Station.active || !Sync.stations ? 'disabled' : ''}>🖨️ Send test page to the printer station</button>` : ''}
                </div>
              </section>`;
  }
});
