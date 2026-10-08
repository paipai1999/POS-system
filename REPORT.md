# Work report

Date: 2026-10-08. All tests: `npm test` → **83 passed** (server API, live multi-device sync, security, backups, money, features, and the real web app clicked through in jsdom).

## Earlier rounds (summary)
Bill and price checks on the server, per-role visibility of orders, stock reservation, salted-hash PINs, Kitchen role limited to tickets, safe printing of other devices' print jobs, receipt no longer closing after payment. Details are in the code and tests.

## This round, item by item

| # | Item | What was done | Verified |
|---|------|---------------|----------|
| 1 | Many devices at once | `server/test/live.test.js`: guest, waiter, cashier and kitchen on live streams at once; two cashiers paying the same bill (one wins); a device catching up after being offline; import reloads everyone. `allow-firewall.bat` opens port 3000. | Tests. **The firewall script was written but not run** (it changes system settings and needs administrator rights). Real phones/Wi-Fi not tried. |
| 2 | Printer | **Settings → Printing → Print test page** (width ruler, wrapped line, Myanmar text, paper cut). Print jobs from other devices are cleaned of scripts before printing. | Page renders in the browser. **No real printer was available**, so printing, paper cut and Myanmar fonts must be tried on the counter PC. |
| 3 | Auto-start | `start-server.bat` restarts the server after a crash (not when it is already running); `install-autostart.bat` / `uninstall-autostart.bat` use a Windows scheduled task. | Restart codes tested (exit 2 when the port is in use). **Autostart scripts not run.** |
| 4 | Demo PINs | Signing in with a demo PIN forces a new PIN (locked dialog, weak PINs refused, uniqueness enforced) in server and single-device mode; `POST /api/me/pin`. | Server tests + browser test. |
| 5 | Backups off the PC's disk | Up to two extra folders (USB / cloud-synced); status screen with freshness and "same disk" warning; Back up now; unplugged drive reported and retried. | 7 tests. |
| 6 | HTTPS | Optional: `node server/make-cert.js` then HTTPS automatically. Security headers and a content-security policy on every response. **No HSTS** (it would block Chrome's "continue" for a self-signed certificate). | HTTPS served and checked with a generated certificate; header tests. |
| 7 | Audit log | Append-only log (13 months): prices, stock, staff, PIN/role changes, settings/tax, voids, refunds, discounts, payments, shifts, bill splits, sign-ins, lock-outs, exports/imports. Settings → Activity log. PINs are never written to it. | 5 tests. |
| 8 | Kitchen role | Receives tickets, staff names and settings only; cannot read orders, prices, payments, guests or create print jobs. | Test + browser check. |
| 9 | Kyat | Money format: symbol before/after, 0 or 2 decimals, thousands commas; bill rounding, quick-cash notes (500 … 50,000) and the server's payment checks follow it. Presets for US dollar and kyat. | Tests. Menu prices are **not converted** when the format changes. |
| 10 | Myanmar interface | 🌐 switch on sign-in, top bar and guest menu; ~500 phrases + sentence patterns; menu/staff/table names left as typed; receipts and kitchen tickets stay English. | Unit tests + browser; every menu label and settings card verified in Myanmar. **Not reviewed by a native speaker.** |
| 11 | New features | Tip; payment split between cash/card/other; split a bill by items (done atomically on the server); priced options per item; cash drawer shifts with server-calculated difference. | 13 server tests + browser tests. |
| 12 | Browser/offline tests | jsdom harness runs the real app against a real server: PIN change, selling, kitchen ticket, **offline queue**, **offline conflict**, tampered price, options/split/tip/drawer, Myanmar switch, single-device mode. | 9 + 5 tests. |
| 13 | One set of rules | Bill/payment validation and stock take/return moved to `js/shared.js` and used by both the browser and the server. Single-device mode now rejects the same bad payments. | Parity test. Single-device PINs are still stored unhashed (documented). |
| 14 | Node version | Server stops with a clear message below Node 22.5; `start-server.bat` checks it and says where to download. | Checked. |

## Security bug found and fixed this round
A path-traversal flaw: `/js/..%2fserver%2fdata%2fpos.db` was served, which would have handed out the whole database (orders and PIN hashes) to anyone on the network. The static-file check ran before `..` was resolved. It now checks the resolved path against the allowed folders; four tests cover the encoded variants.
**The copy already pushed to GitHub (first commit) still contains this flaw** until a new commit is pushed.

## Not done / needs you
- Test with real phones, the real receipt printer, and run `allow-firewall.bat` / `install-autostart.bat`.
- Have a Myanmar speaker read `js/i18n-my.js`.
- Partial payment over time (a balance left open) is not implemented; split by items and split between methods are.
- Guests order items at base price (no options on the guest menu).
- Single-device mode: PINs unhashed, data readable in the browser.
- Choose real PINs; set a backup folder on a USB drive or cloud folder.

## Latest: features taken from Poster POS (2026-10-08)

Chosen by you: ingredient inventory with recipes, purchases and stocktake, customers and loyalty.

| Feature | What it does | Where |
|---------|--------------|-------|
| Ingredients & recipes | Ingredients with unit, cost and low-stock level; a recipe per menu item. Paying a bill uses up the ingredients and writes each dish's cost on the line; a refund restores exactly that. Cost and margin shown per menu item; Reports show ingredient cost and profit on items with a recipe. | Inventory, Menu & Stock |
| Purchases | Stock in with supplier and price paid; cost becomes the weighted average; a manager can void a mistake (stock taken back). | Inventory → Purchases |
| Stocktake | Count what is on the shelves; stock set to the count; difference and its value at cost kept as a record (ingredients and tracked menu items). | Inventory → Stocktake |
| Customers | List with phone, points, spent, visits; add on the spot at checkout; phone numbers unique. | Customers, checkout |
| Loyalty | Optional (Settings). Earn a % of each bill as points; pay part of a bill with points (1 point = 1 unit, up to a set share); refund takes points back; standing discount per customer needs no manager PIN each time. | Settings, Customers, checkout |

How it is built: the rules live once in `js/shared.js` and are used by the server and by single-device mode, so both behave the same. The server does the stock, cost and points work itself at payment; a device cannot send its own cost or points.

Who sees what (enforced by the server): only managers receive ingredients, recipes, costs, purchases and stocktakes; cashiers receive customers (they take payment); waiters and the kitchen do not. Dish costs are removed from the bills sent to non-managers.

Found by the new tests and fixed: a customer discount made the server answer with an error (500) because the activity log looked up a missing approver; odd values sent by a device (an object where an id is expected) are now refused cleanly; after paying in server mode the receipt on screen did not show points earned until the server answered, so the open receipt now refreshes itself.

Tests added: 13 server tests (ingredients, recipes, costs hidden from cashiers, purchases, stocktake, loyalty, customer discount, odd input) and 4 browser tests (the whole flow through the screens in two tabs, single-device parity, Myanmar coverage of the new screens). Total now 83.

Not done on purpose: selling is not blocked when an ingredient runs out (it is flagged instead); priced options do not use extra ingredients; suppliers are typed names; loyalty has one simple scheme (no tiers or expiry). Not tried on real devices. The Myanmar wording of the new screens has not been reviewed by a native speaker.
