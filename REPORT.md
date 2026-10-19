# Work report

Last updated: 2026-10-19 (version 1.1.0). All tests: `npm test` → **372 passed** (server API, live multi-device sync, security, backups, money, features, and the real web app clicked through in jsdom). The newest round is at the end of this file.

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
- Have a Myanmar speaker read the files in `js/i18n/my/`.
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

## Follow-up: running out of ingredients, options that use ingredients, suppliers, loyalty levels

| # | Feature | What it does |
|---|---------|--------------|
| 1 | **When an ingredient runs out** | A setting: do nothing / warn on the dish / stop selling it. The server keeps a short list on each dish of what it lacks, so cashiers and waiters (who are not sent ingredient figures) still see it. "Stop selling" is enforced by the server, counting what open bills already hold, and also covers the guest menu. Each ingredient can be left out ("Watch this ingredient"). |
| 2 | **Options that use ingredients** | Each priced option can list ingredients it uses (an extra shot uses more beans). Paying uses them up and adds them to the dish's cost; the running-out check counts them too. The item editor now has a row editor for options instead of a text box. |
| 3 | **Suppliers** | A supplier list; a purchase records who it was bought from and how much was paid now; the rest is owed to the supplier (kept by the server). Pay a supplier in cash from the till or by bank/other; a statement per supplier; managers can void a purchase or payment. Cash paid to a supplier comes off what the cash drawer should hold, and the cashier's drawer screen shows it. |
| 4 | **Loyalty levels, expiry, visit reward** | Member levels by total spent (own earn % and automatic discount), points that lapse after N months without a visit (restored if that bill is refunded), and a discount on every Nth visit. The best automatic discount applies; the checkout shows the level and why. |

Bugs found by the tests while doing this, all fixed:
- Input placeholders (search boxes, amounts) were never translated into Myanmar, because the translator skipped every `input`.
- A cashier's screen could not tell a dish was sold out once it no longer received recipes (an earlier privacy change); it now relies on the server's list.
- Changes are now sent to the server in an order where an ingredient, supplier or customer arrives before the recipe, purchase or bill that refers to it (a customer added and charged within the same instant could have been refused).
- Text fields sent as objects by a modified device became the text "[object Object]" in names; they are now treated as empty and refused.
- The demo data for single-device mode lacked the new lists, which broke suppliers there.

Tests: 23 more (now 106): server tests for availability, suppliers, loyalty levels and options with ingredients; browser tests for each screen flow in two tabs, single-device parity for suppliers, and Myanmar coverage of the new screens and dialogs.

Not done on purpose: no advance payments to suppliers; no per-customer points history screen; loyalty has levels, expiry and a visit reward but no birthday or time-limited offers; the Myanmar wording of the new screens has not been reviewed by a native speaker.

Everything above is on this PC only. The last push to GitHub was before this follow-up.

## Follow-up: layout check, photos, dashboard, order history, financial statements, and a tidier code base

| # | What | What it does |
|---|------|--------------|
| 1 | **Layout check in a real browser** | Text spilling out of cards was found and fixed: menu tiles with fixed-height rows, the order screen's sideways scroll at 1024 px, Myanmar buttons spilling out of the bill, and a menu bar that could not show eleven buttons (below 860 px it is now a ☰ list; labels show beside every icon only on very wide screens). Input placeholders were never translated; they are now. A developer tool (`js/dev/ui-audit.js`) visits every screen and dialog and reports anything that spills; the final run found nothing at 1920, 1280, 1024, 768 and 390 px, in English and Myanmar. |
| 2 | **Menu photos** | Pick a picture in the item editor; it is shrunk in the browser, uploaded (server) or stored inside the item (single-device mode), shown on the order tile, the item list and the guest menu, copied with the backups, carried inside a backup file, and cleaned up when unused. Only real JPEG/PNG/WebP files are accepted (checked by their bytes; SVG is refused). |
| 3 | **Dashboard** | Live order board by stage and a table overview with seated time and filters. |
| 4 | **Order history** | Period, status, payment, server, table filters, search, sorting, totals, a detail dialog for every order, and a CSV of the filtered list. |
| 5 | **Financial statements** | A **Finance** screen: profit & loss with comparison, cash flow, financial position, tax, expenses (with repeating monthly expenses and owner money), daily close with a lock, and controls (discounts, refunds, voids by person); CSV per statement or all at once, and printing. Cash expenses, cash purchases and the owner's cash moves now count in the cash drawer. Refunds are counted on the day they are made. Purchases record how they were paid and the tax in the price, and the ingredient cost leaves the tax out. |
| 6 | **Code organisation** | The big files were split by responsibility into folders with comments at the top of each file (see the layout in the README): `js/shared/`, `js/finance/`, `js/store/`, `js/sync/`, `js/ui/`, `js/app/`, `js/i18n/`, `css/`, `js/screens/<screen>/`, `server/rules/`, `server/routes/`, `server/http/`. No file is much over 300 lines now. Each split was checked by the test suite before the next one. |

Things found along the way, all fixed:
- A refund moved the original sale out of the month it was sold in, which changed the figures of a month that was already over. Sales now stay in the month of the sale and the refund is taken off in the month it is made.
- At sign-in a device was sent only the last two days of purchases, although the screen says "last 90 days" (two values were swapped); the money records of the last 90 days are sent now, older ones are fetched when a statement needs them.
- A request larger than allowed cut the connection instead of answering "too large".
- Several browser tests put bills "an hour ago", which fell on yesterday when run just after midnight; they now use fixed times of the day.
- One class name of the new statements clashed with the order screen's `.line` and broke the first row of a table; the statements use their own prefix.

Tests: 53 more (now 159): server tests for photos (upload checks, public serving, path tricks, backups, clean-up), the pure financial calculations worked out by hand (profit and loss, cash flow, tax, controls, position, daily summary, repeating expenses) and the ledger rules (who may write and see, validation, the cash drawer, tax in purchases, repeating expenses, the daily close lock, older records, finance setup); browser tests for the dashboard, order history, photos and every Finance tab and dialog, in Myanmar, and in single-device mode.

Not done on purpose: no bank reconciliation, payroll or tips payout screen, sales on account, budgets or multi-currency; the Tax statement is a worksheet, not a tax return; the Myanmar wording of the new screens has not been reviewed by a native speaker; not tried on real devices or a real printer.

Everything above is on this PC only. The last push to GitHub (bb69382) was before all of it.

## Follow-up: sales on account

A customer with a credit limit can take the goods now and pay later.

| What | How it works |
|------|--------------|
| **At checkout** | With a customer on the bill, **On account** appears next to cash / card / other, for the whole bill or as one part of a split. The dialog shows what they owe, their limit and what is available, and does not let the payment through when it is more than that. A tip cannot be put on account. |
| **Server rules** | The credit limit is checked by the server (a modified browser cannot go over it); a manager sets the limit; what a customer owes is kept by the server only; a refund takes the debt back; a customer who owes cannot be deleted. |
| **Customers** | Limit and *Owes* columns, **Receive payment** (cash goes into the open shift's drawer), **Statement** (every bill and payment with the balance, printable), and a manager's **Write off**. Voiding a payment gives the debt back; a closed day is locked as for other money records. |
| **Finance** | New **Receivables** tab with the age of each debt (payments settle the oldest bills first). A sale on account is revenue but not money: the cash flow shows only what customers actually pay, the financial position shows what is owed as an asset, and a write-off is an expense (*Bad debts written off*). The daily close shows what was sold on account and what customers paid. |

Found and fixed while doing it: a statement could briefly show an "earlier balance" line on the device that had just recorded a payment, while the server was still confirming it; a statement now adds up the bills and payments itself when the device holds the customer's whole history.

Tests: 12 more (now 171): server tests for the limit, who may do what, refunds, payments, write-offs, voids, the drawer, the closed-day lock and the activity log; a pure test of the statement and ageing; browser tests for the checkout, the customer screens, receiving a payment, the statement, the receivables tab, Myanmar and single-device mode.

Not done yet (asked for, not started): bank reconciliation, payroll and tips payout, budgets.

Everything above is on this PC only. The last push to GitHub (bb69382) was before all of it.

## Latest round (2026-10-19): security fixes, reliability, owner reports, sales, staff and branches

Everything below is committed and pushed to GitHub (branch `ccr-e7e52610-2azu9a`); the suite went from 171 to 372 tests. Not merged into `main` and no pull request was opened.

### Security (from the review you asked for)
| # | Finding | Fix |
|---|---------|-----|
| 1 | PIN guessing was limited per network address only: a guesser could alternate with a valid login to reset the count, and a PIN could be tried through the PIN-change and the manager-approval boxes | Per-account escalating lock (30 s, 1, 2, 5 minutes) that no other person's login resets; the PIN-change and manager-approval boxes have their own counts; the lock is reported in the activity log |
| 2 | Items already sent to the kitchen could be taken off a bill without a manager | The server refuses it unless a manager approved (signed in, or a manager's PIN typed on that device) |
| 3 | A demo PIN (1234, 1111…) could still be used for everything if a modified browser skipped the PIN-change dialog | The server itself allows nothing but the PIN change until the PIN is replaced |

### Reliability
- **System health** (*Settings*, with a ⚠ mark in the top bar for admins): every backup is opened and checked as soon as it is made (a damaged copy is discarded and reported); stale or missing backups, all backups on the same disk as the data, low disk space and demo PINs are named in plain words.
- **Restore tool** (`restore-backup.bat`, `node server/restore.js`): lists the copies with their order counts and condition, and restores one after saving what was in place. **Owner's guide** in English and Myanmar (`docs/`): daily routine, backups, the monthly restore drill, what to do when things go wrong, a security checklist, and now how to read the numbers.

### Owner reports (*Finance*)
**Business health** (food, labour, prime cost, rent and net margin with verdicts, break-even), **Sales patterns** (weekday, hour, grid, dine-in vs takeaway, tables, servers) and **Menu engineering** (stars, plowhorses, puzzles, dogs). Each warns when the data cannot be trusted.

### Sales
| Feature | What it does |
|---------|--------------|
| **Payment names** | *Other* payments carry a wallet name (KBZPay, Wave Pay, AYA Pay, bank transfer…) on the receipt, orders and reports |
| **Guest options** | Guests choose priced options on the table QR menu; the server prices them itself and refuses names the dish does not offer |
| **Reservations** | Bookings with clash checking by the server, a hint on the table map, seating opens the bill |
| **Deposits** | Money paid in advance is credit on the customer's account (not sales), used at checkout, given back with a manager's PIN; the cash, bank and "owed to customers" figures follow |

### Staff and branches
| Feature | What it does |
|---------|--------------|
| **Staff hours** | Everyone clocks in and out from the top bar on the **server's clock**; managers see hours and wages per person, add a missed shift, correct a forgotten clock-out or delete a shift (all logged). One person cannot have overlapping shifts; a shift cannot be in the future or over 24 hours. A forgotten clock-out counts for nothing until a manager sets the real end (no pay is invented). People see only their own hours; **hourly pay** is set by an admin and is visible to managers and the person themselves only (it is not sent to other devices). |
| **Labour estimate** | When no salaries are recorded, *Business health* estimates labour from hours × pay, says so, and keeps it out of the profit and loss; it also shows sales per staff hour |
| **Tips** | Collected, paid out and still to pay; each person's own tips (the bills they took) and the whole pool shared by hours worked, to the cent |
| **Branches** | Several shops side by side from their backup files (sales, share, average bill, food cost %, labour %, net profit, margin), read in the browser only. Flags a backup that stops before the period ends and two files with the same shop name. Totals only when all shops use the same currency |

Found and fixed along the way: an open phone top bar overflowed the screen by 35 px once the clock button was added (the language switch is now just a globe on narrow phones); a person who forgot to clock out could not clock in again (the old shift is now closed with a flag); the first draft of the attendance rules let a running shift block every later entry silently (the message now names it).

### Not done, and limits you should know
- **Nothing here has been tried on real hardware**: real phones on the restaurant Wi-Fi, the real receipt printer, Windows (`start-server.bat`, `allow-firewall.bat`, `install-autostart.bat`, `restore-backup.bat` and the disk-space check were written but **not run on Windows**; the tests ran on Linux).
- **Myanmar wording** (all of `js/i18n/my/` and `docs/OWNER-GUIDE-my.md`) was written by me and has **not been read by a native speaker**. Please have someone review it.
- **Branches have no live link**: it compares backup files you bring together. A server-to-server sync would be a separate, bigger project (each shop's data, prices and stock would need merge rules).
- **Staff hours are not payroll**: no rosters or schedules, overtime rules, leave, tax or deductions; wages are hours × pay and an aid for checking payroll. The tips report does not pay anyone: you pay and record it under *Finance → Expenses*.
- **Clock-in can be done for yourself only** and relies on each person using their own PIN; someone could clock a friend in by signing in as them (the same trust the rest of the PIN system has). A shared fingerprint or photo check is not included.
- **Deposits and reservations**: no SMS or reminder messages, no online booking page for guests, no automatic release of a late booking.
- Single-device mode keeps PINs unhashed and data readable in the browser (unchanged, documented). Menu prices are not converted when the currency format changes (unchanged).
- Still to do by you: choose real PINs, set a backup folder on a USB drive or cloud folder, practise the restore drill once.

