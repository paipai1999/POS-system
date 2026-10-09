'use strict';

// Printing: sends a receipt to the printer station (or prints from this device) and the printer test page.

// Prints at the counter's printer station when one is online; otherwise on this device.
function printHTML(html, kind = 'receipt') {
  if (Store.server && Sync.token && !Station.active && Sync.stations > 0) {
    Store.data.printJobs.push({ id: uid('j_'), html, kind, status: 'pending', createdAt: Date.now(), by: App.user ? App.user.id : null });
    Store.save();
    toast('🖨️ Sent to the counter printer', 'ok');
    return;
  }
  printLocal(html, kind === 'sheet');
}

// Print jobs come from other devices, so strip anything that could run code before showing them on this one.
function cleanPrintHTML(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  tpl.content.querySelectorAll('script, iframe, object, embed, link, meta, base, form').forEach(el => el.remove());
  tpl.content.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || /^\s*(javascript|data):/i.test(a.value) && /^(href|src|xlink:href|action)$/i.test(a.name)) el.removeAttribute(a.name);
    }
  });
  return tpl.innerHTML;
}

// A page that shows whether the printer prints at the right width, cuts cleanly and can print Myanmar text.
function testPageHTML() {
  const ruler = n => '1234567890'.repeat(Math.ceil(n / 10)).slice(0, n);
  return `
    <div class="receipt">
      <div class="c b big">${esc(Store.settings.name)}</div>
      <div class="c b r-title">PRINTER TEST</div>
      <div>${fmtDateTime(Date.now())}</div>
      <hr>
      <div>Width check: every line below should be fully visible, not cut off at the right edge.</div>
      <div style="white-space:nowrap;overflow:hidden">${ruler(48)}</div>
      <div style="white-space:nowrap;overflow:hidden">${ruler(42)}</div>
      <div style="white-space:nowrap;overflow:hidden">${ruler(32)}</div>
      <hr>
      <table>
        <tr><td>2 x Chicken Burger with extra long name that wraps</td><td class="r">${money(25.8)}</td></tr>
        <tr><td>1 x Latte</td><td class="r">${money(4)}</td></tr>
        <tr class="b big"><td>TOTAL</td><td class="r">${money(29.8)}</td></tr>
      </table>
      <hr>
      <div>မြန်မာစာ စမ်းသပ်ခြင်း — ကော်ဖီ၊ လက်ဖက်ရည်၊ ထမင်းကြော်</div>
      <div>Letters: ÀÉÎÕÜ àéîõü ñ ç · Symbols: ${esc(Store.settings.currency)} # % &amp; @ ✓</div>
      <hr>
      <div class="c b">If the Myanmar line shows boxes or gaps, install a Myanmar font on this PC (e.g. "Myanmar Text" or "Noto Sans Myanmar").</div>
      <div class="c">Paper should cut after this line.</div>
      <div>&nbsp;</div><div>&nbsp;</div>
    </div>`;
}

// `sheet` uses the full page width (QR code sheets) instead of the 80 mm receipt width.
function printLocal(html, sheet = false) {
  const area = $('#print-area');
  area.className = sheet ? 'sheet' : '';
  area.innerHTML = html;
  window.print();
}
