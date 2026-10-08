# Security & reliability fixes — report

Date: 2026-10-07. Test run: `node --test server/test/api.test.js` → 21 passed (12 existing, 9 new).

## 1. Printer station removal (admin only)
- **Problem:** `POST /api/station/unregister` had no role check; any signed-in user could remove a printer station.
- **Fix:** admin check added ([server/server.js](server/server.js), same rule as `register`).
- **Test:** waiter gets 403 and the station still works; admin succeeds and the station is then refused.

## 2. Server checks the bill (prices, totals, change)
- **Problem:** the server trusted line prices and `totals.total` sent by the device.
- **Fix** ([server/sync.js](server/sync.js)):
  - A new order line must match the current menu price; an existing line can never change price or product.
  - At payment the server recalculates subtotal, discount, service, tax and total from its own settings. A device total that differs is rejected ("total no longer matches… reopen the order"). The stored totals are the server's.
  - Payment method must be cash/card/other; cash must cover the total; `amount` and `change` are calculated by the server.
  - Discounts must be type `percent` or `amount`, and a percent cannot exceed 100.
  - The calculation now lives once in `computeTotals` ([js/shared.js](js/shared.js)); the browser's `Store.totals` uses the same function, so the two cannot drift apart.
- **Trade-off:** if an admin changes the tax rate while a bill is open (or an offline device pays after a rate change), that payment is rejected and the cashier must reopen the order. This is deliberate: a visible error rather than a bill that differs from what the customer was shown.
- **Test:** invented price, edited price, wrong total, short cash, invalid method, server-calculated change.

## 3. Who can read orders and sales
- **Problem:** every signed-in user received all orders (including others' payments) in the snapshot, live updates and `GET /api/orders`.
- **Fix:**
  - Cashier, manager and admin: unchanged (see everything).
  - Waiter: sees all open orders (needed for the table map) and their own finished orders; other people's paid/refunded/void orders are not sent.
  - When a colleague's open order is paid, the waiter's device receives a deletion for it, so the table does not stay "busy" on their screen.
  - `GET /api/orders` needs the `orders` permission (Kitchen gets 403) and is filtered the same way.
- **Not changed:** the Kitchen role still receives the normal snapshot (the kitchen screen reads orders for labels). Say if you want that narrowed too.
- **Test:** waiter vs cashier vs kitchen, including the deletion message.

## 4. Overselling tracked stock
- **Problem:** two devices could each add the last portion; payment then just clamped stock to 0.
- **Fix:** when an open order is saved, any increase of a tracked item is checked against stock minus items reserved on other open orders; otherwise "Not enough X in stock". Lowering a quantity, or items already on the order, is never blocked. Payment is not blocked (food already served must still be paid for).
- **Test:** brownie stock 10: 6 reserved, a second order for 5 is refused, 4 is accepted.

## 5. PIN hashing (server mode)
- **Problem:** PINs were stored as plain digits in the database, in every daily backup and in exported backups.
- **Fix** ([server/pins.js](server/pins.js)): a PIN is stored only as `scrypt$salt$hash` (new random salt per user). Login, manager approval (`verify-pin`), the "PIN already used" rule and the demo-PIN warning all work through the hash.
  - A device can only send digits; a `pinHash` in a request is ignored, so a hash cannot be copied from one account to another. Editing a user without a new PIN keeps the existing hash.
  - Demo data, imported backups and databases from older versions are converted on start/import. Plain PINs are never written (`loadDataset` hashes first); for old databases the file is compacted (`VACUUM`) so old plain rows are not left in free pages or the write-ahead log.
  - Exported backups contain hashes, never digits; old-style backups with plain PINs still import.
- **Limits:** with only 4–6 digits, a stolen database could still be brute-forced offline, so keep `server/data` private. Daily backups made *before* this change (none exist yet on this machine) would still contain plain PINs. Single-device mode (no server) still stores PINs unhashed in the browser.
- **Test:** 4 new tests (hash format and unique salts, no plain PIN in the database file, PIN change re-hashes, planted hash ignored, old database and old backup conversion, demo warning).

## Also fixed while testing in the browser (server mode)
- After a cashier paid, the server's reply refreshed the order screen, which closed the receipt dialog and showed "paid on another device". The order screen now ignores its own payment while the receipt is open ([js/screens/order.js](js/screens/order.js)). Verified in the browser: tampered price is rejected and reverted, payment completes, receipt stays open.

## Earlier round (single-device mode)
Storage sync no longer wipes data from a cleared/corrupt entry; modal saves use fresh records; refund returns exactly the stock taken; empty open orders cleaned at start; settings defaults and order numbers never reused; currency symbol sanitised; guest requests for deleted tables rejected.

## Still open (not done)
- PINs travel over plain HTTP on the LAN.
- Backups are written to the same disk (`server/data/backups`); copy them to a USB drive or cloud folder.
- Change the demo PINs (admin 1234, kitchen 3333, …) before real use.
- No automated tests for the browser screens or the offline queue (`js/sync.js`).
- Single-device mode (`js/store.js`) still has its own copy of the stock logic and does not have these server checks, and keeps PINs unhashed.
