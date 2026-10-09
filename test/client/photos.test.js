'use strict';

// Menu photos through the screens: choosing one in the item editor, then seeing it on the order screen, the item list and
// the guest menu. jsdom cannot shrink a picture (it has no canvas), so that one step is replaced; the upload is real.
// Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, startServer, openApp } = require('./harness.js');

const opts = JSDOM ? {} : { skip: 'jsdom is not installed (run "npm install" once)' };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let srv;
const tabs = [];
const open = async o => { const t = await openApp(srv.base, o); tabs.push(t); return t; };
const pid = (tab, name) => tab.get(`Store.data.products.find(p => p.name === ${JSON.stringify(name)}).id`);
const prod = name => srv.app.db.all('products').find(p => p.name === name);

test.before(async () => { if (JSDOM) srv = await startServer(); });
test.after(async () => {
  tabs.forEach(t => { try { t.close(); } catch (e) { /* already closed */ } });
  if (srv) await srv.stop();
});

// Picks a file in the editor the way the browser would, with the shrinking step replaced by a ready-made small picture.
function pickFile(tab, { fail = null } = {}) {
  tab.get('Photo').prepare = async () => {
    if (fail) throw new Error(fail);
    return { blob: Object.assign(new Uint8Array(PNG), { type: 'image/png' }), width: 1, height: 1 };
  };
  const input = tab.$('.modal [data-role=photo-file]');
  Object.defineProperty(input, 'files', { configurable: true, value: [new tab.w.File(['x'], 'burger.png', { type: 'image/png' })] });
  input.dispatchEvent(new tab.w.Event('change', { bubbles: true }));
}

test('choose a photo for a menu item: it is uploaded, saved with the item, and shown on every screen', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '1234', '482915');
  admin.click('[data-nav=products]');
  await admin.until(() => admin.screen() === 'products');
  admin.click(`[data-act=edit][data-id="${pid(admin, 'Espresso')}"]`);
  await admin.until(() => admin.modalTitle() === 'Edit item');
  assert.equal(admin.$('.modal .photo-preview img'), null, 'no picture yet: the icon is shown');
  assert.equal(admin.$('.modal [data-act=photo-clear]').hidden, true, 'nothing to remove yet');

  pickFile(admin);
  await admin.until(() => admin.$('.modal .photo-preview img'), { what: 'the preview of the uploaded picture' });
  const src = admin.$('.modal .photo-preview img').getAttribute('src');
  assert.match(src, /^\/photos\/[a-f0-9]{24}\.jpg$|^\/photos\/[a-f0-9]{24}\.png$/);
  assert.equal(admin.$('.modal [data-act=photo-clear]').hidden, false);
  admin.click('.modal [data-act=save]');
  await admin.until(() => prod('Espresso').photo, { what: 'the photo name on the server' });
  assert.equal('/photos/' + prod('Espresso').photo, src);
  assert.deepEqual(fs.readFileSync(path.join(srv.dataDir, 'photos', prod('Espresso').photo)), PNG, 'the uploaded bytes are what is stored');

  // The item list shows a thumbnail instead of the icon.
  await admin.until(() => admin.$(`table.data img.cell-photo`), { what: 'the thumbnail in the item list' });

  // A cashier on another device sees it on the order screen tile, and only that item has one.
  const cashier = await open();
  await cashier.signIn('Maya', '1111', '735192');
  cashier.click('[data-act=table][data-id]:not(.busy)');
  await cashier.until(() => cashier.screen() === 'order');
  const tile = () => cashier.$(`.product-tile[data-id="${pid(cashier, 'Espresso')}"]`);
  await cashier.until(() => tile() && tile().querySelector('img.p-photo'), { what: 'the photo on the Espresso tile' });
  assert.equal(tile().querySelector('img.p-photo').getAttribute('src'), src);
  assert.equal(tile().querySelector('.p-emoji'), null, 'the icon is replaced by the picture');
  assert.equal(cashier.$(`.product-tile[data-id="${pid(cashier, 'Latte')}"] img`), null, 'items without a photo keep their icon');
  assert.ok(cashier.$(`.product-tile[data-id="${pid(cashier, 'Latte')}"] .p-emoji`));

  // If the picture cannot be loaded, the tile falls back to the icon instead of showing a broken image.
  const img = tile().querySelector('img.p-photo');
  img.dispatchEvent(new cashier.w.Event('error'));
  assert.equal(tile().querySelector('img.p-photo'), null);
  assert.match(tile().querySelector('.p-emoji').className, /photo-missing/);
  assert.equal(tile().querySelector('.p-emoji').textContent, prod('Espresso').emoji);

  // The guest menu (QR code page).
  const table = srv.app.db.all('tables')[0];
  const guest = await open({ path: '/?table=' + table.guestCode });
  await guest.until(() => guest.screen() === 'guest', { what: 'the guest menu' });
  await guest.until(() => guest.$$('.menu-card img.photo').length === 1, { what: 'one photo on the guest menu' });
  assert.equal(guest.$('.menu-card img.photo').getAttribute('src'), src);
  assert.ok(guest.$$('.menu-card .emoji').length > 3, 'the other dishes show their icon');
});

test('removing the photo, and a picture that cannot be used', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=products]');
  await admin.until(() => admin.screen() === 'products');
  admin.click(`[data-act=edit][data-id="${pid(admin, 'Espresso')}"]`);
  await admin.until(() => admin.modalTitle() === 'Edit item');
  assert.ok(admin.$('.modal .photo-preview img'), 'the saved picture is shown again');

  // A file the browser cannot open: a message, and the old picture stays.
  pickFile(admin, { fail: 'This browser could not open that picture' });
  await admin.until(() => admin.toasts().some(t => /could not open that picture/.test(t)), { what: 'the error message' });
  assert.ok(admin.$('.modal .photo-preview img'));

  admin.click('.modal [data-act=photo-clear]');
  assert.equal(admin.$('.modal .photo-preview img'), null);
  admin.click('.modal [data-act=save]');
  await admin.until(() => !prod('Espresso').photo, { what: 'the photo removed on the server' });
  assert.equal('photo' in prod('Espresso'), false);
});

test('Save waits while a photo is still uploading', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=products]');
  await admin.until(() => admin.screen() === 'products');
  admin.click(`[data-act=edit][data-id="${pid(admin, 'Latte')}"]`);
  await admin.until(() => admin.modalTitle() === 'Edit item');
  let release;
  admin.get('Photo').prepare = () => new Promise(r => { release = () => r({ blob: Object.assign(new Uint8Array(PNG), { type: 'image/png' }) }); });
  const input = admin.$('.modal [data-role=photo-file]');
  Object.defineProperty(input, 'files', { configurable: true, value: [new admin.w.File(['x'], 'a.png', { type: 'image/png' })] });
  input.dispatchEvent(new admin.w.Event('change', { bubbles: true }));
  await admin.until(() => /Uploading photo/.test(admin.text('.modal .photo-preview')), { what: 'the uploading note' });
  admin.click('.modal [data-act=save]');
  assert.ok(admin.toasts().some(t => /Wait for the photo/.test(t)));
  assert.equal(admin.modalTitle(), 'Edit item', 'the editor stays open');
  release();
  await admin.until(() => admin.$('.modal .photo-preview img'), { what: 'the preview' });
  admin.click('.modal [data-act=save]');
  await admin.until(() => prod('Latte').photo, { what: 'the photo saved' });
});

test('Myanmar: the photo field is translated', opts, async () => {
  const admin = await open({ lang: 'my' });
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=products]');
  await admin.until(() => admin.screen() === 'products');
  admin.click(`[data-act=edit][data-id="${pid(admin, 'Latte')}"]`);
  await admin.until(() => admin.$('.modal .photo-field'));
  await admin.sleep(100);
  assert.ok(!/[A-Za-z]/.test(admin.text('.modal .photo-field').replace(/JPEG|PNG|WebP/g, '')), admin.text('.modal .photo-field'));
});
