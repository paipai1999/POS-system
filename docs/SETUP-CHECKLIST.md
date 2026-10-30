# Opening-day checklist

Print this and tick each line. (A Myanmar version is in [SETUP-CHECKLIST-my.md](SETUP-CHECKLIST-my.md); the daily routine is in the [owner's guide](OWNER-GUIDE.md).)

**What has been tested and what has not**
- Tested: 372 automated tests pass on Linux, and the screens (desktop and phone width) were looked at in a real browser.
- **Not tried yet**: the Windows `.bat` files, the shop's own Wi-Fi with real phones, the real receipt printer, and a Myanmar speaker reading the Myanmar text. Sections 1, 2, 5 and 6 below are there to check exactly those.

Nothing needs installing for the server except Node.js **22.5 or newer** (the LTS download).

---

## 1. The counter PC (before opening)

- [ ] `start-server.bat` opens `http://localhost:3000`. (If Node is too old, note what the message says.)
- [ ] `allow-firewall.bat` has been run once **as administrator** (right-click → Run as administrator).
- [ ] The Wi-Fi network in Windows is set to **Private**. (If it is *Public*, phones cannot connect.)
- [ ] The router has a **DHCP reservation** for this PC. (If its address changes, phones and the table QR codes stop finding it.)
- [ ] A phone on the shop's Wi-Fi opens the "Other devices" address (for example `192.168.1.20:3000`).
- [ ] `install-autostart.bat` has been run once, the PC restarted, and the server came back by itself. (For an unattended PC that must recover from a power cut, also set Windows to sign in automatically; see the README.)
- [ ] **Settings → System health** is open and the backup and disk-space figures make sense. (This check has not been tried on Windows.)
- [ ] **Settings → Data & backup → Backup folders** has a USB drive or a cloud folder (OneDrive / Google Drive / Dropbox).
- [ ] **Back up now** was pressed and that folder shows **"Different disk ✓"**. (If not, the backups sit on the PC's own disk and are lost with it.)
- [ ] `restore-backup.bat` was practised **before real data went in**, the server restarted, and the data came back. (It saves what was in place as `before-restore-…` first.)
- [ ] A small **UPS** protects the server PC, so a power cut cannot damage the database.

## 2. The receipt printer

- [ ] The counter was opened with `open-counter.bat`, and **Settings → "This device is the printer station"** is ticked.
- [ ] **Settings → Printing → Print test page** was printed on the real printer: paper **80 mm**, margins **None**.
- [ ] The paper is cut, lines do not run off the edge, and **Myanmar text** prints correctly.
- [ ] A kitchen ticket (if turned on) and a bill both print for real.
- [ ] A spare paper roll is in the drawer.

## 3. Staff and PINs

- [ ] Every demo PIN (1234, 1111, 2222, 3333) has been replaced by the person's own 4–6 digit PIN. (The server refuses to do anything else until it is.)
- [ ] **Staff** shows real names; people who left are set to inactive (never deleted).
- [ ] **System health** says no demo PIN is left.
- [ ] Each person's **hourly pay** is set under *Staff → Edit*. (Hours and Business health need it to show wages.)
- [ ] Nobody shares a PIN, and staff know only managers approve discounts, voids and refunds.

## 4. Menu and settings (the easiest things to forget)

- [ ] The **demo menu** (Espresso, Latte…) has been replaced or deleted and your own menu entered.
- [ ] Prices are right, and the **tax %** and **service charge** are set.
- [ ] The currency format is right (for kyat: 0 decimals). **Note:** changing the format does not convert existing menu prices.
- [ ] **Settings → Payment names** lists the wallets you use (KBZPay, Wave Pay, bank transfer…).
- [ ] Dishes have **recipes**. (Without them Business health shows a food cost that is better than the truth.)
- [ ] Salaries are set as a repeating expense under **Finance → Expenses**.
- [ ] Tables are entered, table **QR codes** printed (*Settings → Tables → Print table QR codes*) and stuck on every table.

## 5. Try it with staff and real phones (about 30 minutes)

- [ ] An order from start to finish: take it → **Send** → it shows in the kitchen → **Ready** → the waiter's phone sounds or vibrates → **Served** → payment.
- [ ] Turn the Wi-Fi off on a phone on purpose: **Offline · N waiting** shows, and the orders go through when it is back. (Do not close the page meanwhile.)
- [ ] A guest scans a table QR code and orders; options with a price can be chosen.
- [ ] Pay once with each method (cash, card, a wallet, split, with a tip) and check the receipt.
- [ ] **Cash drawer → Start shift** (type the real cash) and **Close shift**, and understand the difference shown.
- [ ] Everyone presses the **clock button** in the top bar. On phones the button shows and nothing spills off the screen.
- [ ] A **reservation** is entered and shows on the table map.
- [ ] A discount works with a manager's PIN, and does not with a waiter's.

## 6. Myanmar text

- [ ] A Myanmar speaker reads the screens staff use every day first (**Tables, Order, Checkout, Kitchen, the clock button**) and notes anything wrong.
- [ ] Then `docs/OWNER-GUIDE-my.md` and the files in `js/i18n/my/`, and the corrections are made.

## 7. The first week

- [ ] Every night: **Close shift**, then **Finance → Daily close**.
- [ ] Every day: **System health** shows no ⚠.
- [ ] In the first 3 days: read **Settings → Activity log** for unexpected price changes, voids, discounts or locked accounts.
- [ ] Every day's KBZPay / Wave total is compared with that wallet's own app.
- [ ] At the end of the week: **Hours** has no *no clock-out* warnings left.
- [ ] At the end of the week: **Finance → Business health** warnings (few recipes, no salaries recorded) have been read and fixed.

---

## Limits worth knowing

- The system trusts PINs. Someone can clock a friend in by signing in with the friend's PIN.
- After a manager's PIN is typed, that session can do several approved actions for 10 minutes (a design choice, not a bug).
- **Branches** compares backup files you bring together; the servers are not linked.
- **Hours** is not payroll (no rosters, overtime, leave or tax). **Tips** does not pay anyone: pay them, then record it under *Finance → Expenses*.

Checked by: ____________________  Date: ____________________
