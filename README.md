# Restaurant POS

A point-of-sale system for restaurants and cafes. It runs in two ways:

- **Multi-device (recommended).** One PC runs the POS server. The counter PC, waiters' phones, a kitchen screen and guests' phones all use it over the restaurant Wi-Fi and stay in sync live.
- **Single device (trial / one counter).** Double-click `index.html`. Everything is saved in that browser only, and no server is needed. It has the same screens and the same payment and stock rules, but no PIN protection beyond the browser and no live sharing between devices.

The interface can be switched between **English and မြန်မာ** with the 🌐 button on the sign-in screen, the top bar and the guest menu. The choice is remembered per device.

## Multi-device setup

You need [Node.js](https://nodejs.org) **22.5 or newer** (the "LTS" download) on the PC that runs the server. `start-server.bat` checks this and says so if it is too old. There is nothing else to install.

1. **Start the server.** On the counter PC, double-click `start-server.bat`. It shows the address to use, for example:
   ```
   On this PC:     http://localhost:3000
   Other devices:  http://192.168.1.20:3000
   ```
   Keep that window open while the restaurant is using the POS (it can be minimised). If the server ever stops unexpectedly, the window restarts it by itself after 5 seconds.
2. **Start it automatically.** Double-click `install-autostart.bat` once. The server then starts whenever this Windows user signs in. For a PC that should come back after a power cut with nobody there, also set Windows to sign in automatically (`netplwiz`) and turn on "restart after power failure" in the BIOS. Undo with `uninstall-autostart.bat`.
3. **Let phones reach it.** Right-click `allow-firewall.bat` and choose **Run as administrator** (once). It opens port 3000 for devices on a *Private* network. If the PC's network is marked *Public* in Windows, change it to *Private*.
4. **Fix the PC's address.** In your Wi-Fi router, reserve this PC's IP address (a "DHCP reservation"). If the address changes, the other devices and the table QR codes stop finding the server.
5. **Set up the counter PC.**
   - Double-click `open-counter.bat`. It opens the POS in Chrome so that it prints without the print dialog.
   - Sign in as Admin, open **Settings**, and tick **"This device is the printer station"**.
   - Under **Settings → Printing**, press **Print test page**. It checks the paper width, the paper cut and Myanmar text. In the print window choose the receipt printer, paper size 80 mm and margins "None". Printers and fonts differ, so this must be tried on the real printer.
6. **Phones and tablets.** On the restaurant Wi-Fi, open the "Other devices" address and add it to the home screen.
7. **Kitchen screen.** Open the same address on a tablet in the kitchen and sign in as **Kitchen**. The kitchen screen receives only the tickets, never prices, payments or other orders.
8. **Table QR codes.** Go to **Settings → Tables → Print table QR codes** and put one on each table. Guests scan the code, browse the menu, order, and call a waiter, all from their own phone, on the restaurant Wi-Fi.

### First sign-in: choose your own PIN

The demo PINs are listed below only so you can try the system. **Anyone who signs in with a demo PIN is asked to choose their own 4–6 digit PIN and cannot continue until they do.** Easy PINs (1234, 0000, 7777…) are refused. Staff accounts are managed under **Staff**.

| Staff   | Role    | Demo PIN |
|---------|---------|----------|
| Admin   | Admin   | 1234 |
| Maya    | Cashier | 1111 |
| Leo     | Waiter  | 2222 |
| Kitchen | Kitchen | 3333 |

### How an order flows

1. A guest scans the table QR code, or a waiter takes the order.
2. The waiter's phone gets a 🔔 alert and they accept the order.
3. The waiter taps **Send**. The order appears on the **kitchen screen**, and a kitchen ticket prints at the counter if that option is on in Settings.
4. The cook taps **Ready**. The waiter's phone beeps and vibrates, and the table shows 🍽️ until they tap **Served**.
5. The waiter taps **Print bill**, which prints at the counter. The cashier takes payment, and the table becomes free on every device.

### If the Wi-Fi drops

Devices keep working. The top bar shows **Offline · N waiting**, and changes are sent automatically when the connection returns. Don't reload or close the page while it shows Offline. If two devices changed the same bill meanwhile, the newer version on the server wins and the person is told.

### Data and backups

- **Where data is stored:** `server/data/pos.db`.
- **Daily backups:** a copy is saved every day in `server/data/backups` (newest 30 kept). **That is the same disk as the data**, so it does not protect against a failed disk.
- **Backup to a USB drive or cloud folder:** **Settings → Data & backup → Backup folders**. Enter the full path of up to two existing folders (a USB drive, or a OneDrive / Google Drive / Dropbox folder). A copy is saved there every day, and the screen shows when each folder last got one and warns if a drive is unplugged or all copies are on the same disk. **Back up now** makes a fresh copy immediately.
- **Moving data:** **Settings → Export / Import backup** moves data between machines (including from single-device mode to the server).
- **Activity log:** **Settings → Activity log** lists who changed prices, stock, staff, settings or tax, who voided, refunded or discounted a bill, who closed a shift with a difference, and who signed in or downloaded the data. It cannot be edited and is kept for 13 months.

### HTTPS (optional)

By default devices talk to the server over plain HTTP, which is fine on a Wi-Fi network you control. To encrypt it, run `node server\make-cert.js` once (it needs OpenSSL, which comes with [Git for Windows](https://git-scm.com)), then restart the server; it uses HTTPS automatically when `server/certs/key.pem` and `cert.pem` exist. Each phone shows a one-time "not private" warning for this self-made certificate: choose *Advanced → Continue*. Run the script again if the PC's address changes. Delete the `certs` folder to go back to HTTP.

## Features

- **Tables & takeaway**: table map with live totals, time open, assigned server, and move-table.
- **Ordering**: category and search menu, quantities, per-item kitchen notes, order notes, and **priced options** (extra shot +0.50, large +1.00 …) that you define per item under Menu & Stock.
- **Split the bill**: ⋯ → *Split the bill* moves chosen items onto a separate bill that is paid on its own.
- **Kitchen display**: live ticket queue with timers that turn amber after 10 minutes and red after 20. **Ready** notifies the waiter.
- **Checkout**: % or fixed discount (manager approval), tax, optional service charge, an optional **tip**, and payment by cash, card, other, or **split between methods** (for example 2,000 cash and the rest by card). Cash shows quick-cash buttons and the change due. The server recalculates every bill itself.
- **Cash drawer**: *Cash drawer → Start shift* with the cash in the drawer; at the end *Close shift*, count the cash, and the POS shows the difference against what should be there (opening cash + cash taken − cash refunds). Past shifts are listed.
- **Receipts**: 80 mm receipts and pre-bills with tip and split payments.
- **Money format**: *Settings → Money format* — US dollar ($1,234.50) or Myanmar kyat (1,500 Ks, no decimals, symbol after), or custom. Changing the format does not convert prices; edit them under Menu & Stock.
- **Ingredients & recipes** (*Inventory → Ingredients*): list what you cook with (coffee beans in g, milk in ml…) and give each menu item a **recipe**: what one portion uses (*Menu & Stock → edit item → Recipe*). When a bill is paid the ingredients are used up, each dish's **cost** is recorded, and the menu list shows the cost and margin of every item. A refund puts back exactly what was used. Stock may go below zero if you sell without restocking the count; a stocktake sets it right.
  - **Options that use ingredients**: in the item editor each priced option (extra shot +0.50, oat swap…) can list the extra ingredients it uses, so an extra shot also takes more beans from stock and adds to the dish's cost.
  - **When an ingredient runs out** (*Settings → When an ingredient runs out*): *Do nothing*, *Warn on the dish* (the menu tile shows "⚠ Running out: Milk" but it can still be sold), or *Stop selling the dishes that need it* (the tile shows "Sold out: Milk", the server refuses to add it to a bill, and guests cannot order it). The count includes what open bills already hold. An ingredient can be left out of this by unticking *Watch this ingredient*. Waiters and cashiers are sent only the list of what each dish is short of, never the ingredient figures.
- **Purchases and suppliers** (*Inventory → Purchases / Suppliers*): keep a list of suppliers, and record stock you buy (supplier, amount, price paid, and how much you paid now). The amount goes into stock and each ingredient's cost moves to the weighted average of what you paid. Whatever you did not pay is **owed to the supplier** and shown on the Suppliers tab until you record a payment (cash from the till, or bank/other). A cash payment also comes off what the cash drawer should hold at the end of the shift. A supplier's statement lists purchases and payments; a manager can void a purchase or a payment entered by mistake.
- **Stocktake** (*Inventory → Stocktake*): type what you counted on the shelves; stock is set to your count and the difference, with its value at cost, is kept as a record. Menu items with stock tracking can be counted too.
- **Customers & loyalty** (*Customers*): a customer list with phone, points, total spent and visits. At checkout, *Choose customer* (or add a new one on the spot). With loyalty switched on in *Settings* (admin), a paid bill earns the customer a percentage of the total as points, and a later bill can be paid partly with points (1 point = 1 unit of money, up to a set share of the bill). A manager can also give a customer a standing discount, which is applied automatically without asking for a manager PIN each time. A refund takes the points back. The receipt shows points used, earned and the balance.
  - **Member levels**: by total spent (for example Silver from 100, Gold from 300), each level can earn at its own % and give an automatic discount. The checkout shows the customer's level.
  - **Points lapse** after a number of months without a visit (0 = never). They are cleared the next time the customer pays; a refund of that bill brings them back.
  - **Visit reward**: every Nth visit (for example the 5th) gets an automatic discount. When a customer qualifies for several discounts (their own, their level's, a visit reward) the best one is used.
- **Sales on account** (*Customers*, checkout, *Finance → Receivables*): a customer with a **credit limit** (set by a manager in the customer's details) can take the goods now and pay later. At checkout choose the customer and **On account**, for the whole bill or as one part of a split (for example cash for most of it and the rest on account). The server checks the limit, keeps what each customer owes, and refuses a tip on the account part. In *Customers*, **Receive payment** records what they pay (cash goes into the drawer of the open shift; card and bank are recorded too) and **Statement** lists every bill and payment with the balance after each (printable). A manager can **write off** a debt that will not be paid; it counts as an expense (*Bad debts written off*). *Finance → Receivables* lists who owes what and how old it is (0-30, 31-60, 61-90, over 90 days; payments settle the oldest bills first). A sale on account is revenue on the day of the sale but is not money received: the cash flow only shows it when the customer pays, and the financial position shows it as an asset (*Owed by customers*). A refund of such a bill takes the debt back.
- **Menu & stock**: items, categories, emoji icons, options, on/off sale toggle. Stock is reserved on open orders and deducted at payment, with low-stock alerts. An order cannot claim more than is left.
- **Reports**: sales, net, tax, discounts, refunds (counted on the day they are made), tips, ingredient cost and profit on items that have a recipe, purchases, best sellers, and sales by category, payment method, server and hour. CSV export.
- **Menu photos**: in the item editor (*Menu & Stock → edit item → Choose photo*) pick a picture from the phone or PC. The app shrinks it (about 640 px, a few dozen KB) before storing it; with the server the file is kept in `server/data/photos` and copied next to the daily backups. The photo shows on the order screen tile, the item list and the guest menu; items without one keep their emoji, and a picture that cannot be loaded falls back to the emoji. A backup file carries the pictures inside it, so it restores on another PC.
- **Dashboard** (*Dashboard*): a live overview for the floor. **Orders** shows every open order by stage (ordering → in the kitchen → ready to serve → waiting for payment) plus what was paid today, with timers that turn amber and red; **Tables** shows every table at a glance (free, ordering, cooking, ready, waiting for payment, guest calling) with how long it has been seated, and filters.
- **Order history** (*Orders*): filter by period (today … custom dates), status, payment method, server and table; search by number, table, dish or customer; sort; totals for what is shown; "Show more" for long lists. Click any order for the full story (times, who, items with options and notes, discount and who approved it, payment, loyalty, kitchen timings, ingredient cost for managers) with Receipt / Open / Refund. **Export CSV** saves exactly the filtered list.
- **Finance** (*Finance*, managers and admins): the financial statements, each with its own CSV and Print, and one button for all statements as separate files for the accountant (Excel opens Myanmar text correctly).
  - **Profit & loss**: gross sales, discounts, refunds, net sales, service charge, cost of goods, gross profit, expenses by category and net profit, compared with the period before. The cost of goods comes from the recipes (plus stock lost or found in stocktakes) or from what was bought; the screen warns when many dishes have no recipe, because profit then looks higher than it is. Tax and tips are not income and are left out.
  - **Cash flow**: money in and out by cash / card / bank-wallet: customers' payments, refunds, purchases paid, supplier payments, expenses and the owner's money.
  - **Financial position**: cash and bank (from the opening balances in *Settings → Finance setup* plus every movement since), ingredients on the shelf, what is owed to suppliers, and the net position.
  - **Tax**: tax charged on sales by rate (less refunds), tax paid on purchases and expenses (when entered), and the difference to pay or claim.
  - **Expenses**: rent, salaries, utilities… by category (the list is in Settings), paid in cash from the till, by card or by bank/wallet, with the tax included if you want it tracked. **Repeating expenses** (rent, salaries) are recorded automatically once a month by the server (never from the till); a voided one is not brought back. **Owner money** records money put in or taken out. Records are voided, not edited.
  - **Daily close**: closes a day and freezes its figures (the server works them out itself, from the records). After that nothing dated in that day can be added or voided (expenses, purchases, supplier payments, owner money); only an admin can reopen the day, and the activity log keeps a note. The report can be printed.
  - **Controls**: who gave discounts, made refunds and voided bills, with the big ones listed so they can be checked.
  - A **cash expense**, a **cash purchase** and the owner's **cash** moves count in the cash drawer: they come off (or go into) what the drawer should hold at the end of the shift. A refund is taken off on the day it is made, not on the day of the original sale, so a month that is over never changes.
- **Staff & roles**: Admin, Manager, Cashier, Waiter and Kitchen, each with their own PIN.
- **Guest ordering**: on the guest's own phone via the table QR code, or on a restaurant tablet in guest mode. Waiters accept requests into the table's order. (Guests order items at their base price; a waiter adds options.)

## Roles

| Permission                        | Admin | Manager | Cashier | Waiter | Kitchen |
|-----------------------------------|:-----:|:-------:|:-------:|:------:|:-------:|
| Tables, orders, guest requests    | ✓ | ✓ | ✓ | ✓ (open orders + own) |   |
| Kitchen display (tickets only)    | ✓ | ✓ |   |   | ✓ |
| Take payments, cash drawer        | ✓ | ✓ | ✓ |   |   |
| Approve voids, refunds, discounts | ✓ | ✓ |   |   |   |
| Menu & stock, reports             | ✓ | ✓ |   |   |   |
| Finance: statements, expenses, owner money, daily close, controls | ✓ | ✓ |   |   |   |
| Reopen a closed day, finance setup (Settings) | ✓ |   |   |   |   |
| Staff, settings (incl. loyalty), activity log, backups | ✓ |   |   |   |   |
| Inventory, recipes and costs, purchases, suppliers and payments, stocktake | ✓ | ✓ |   |   |   |
| Customers: add, choose at checkout, use points | ✓ | ✓ | ✓ |   |   |
| Set a customer's points or standing discount | ✓ | ✓ |   |   |   |

In multi-device mode the server enforces these rules, and also what each role is sent: a waiter's phone never receives other people's payments, the kitchen screen never receives prices, and only managers receive ingredients, recipes, costs, purchases, suppliers, expenses and the other finance records (cashiers see customers, because they take payment, and the amount of cash paid out of or put into the till during their shift: supplier payments, cash purchases, cash expenses and the owner's cash moves; waiters do not).

## Security notes

- **PINs:** checked on the server, never sent to phones, and stored only as salted hashes (`server/pins.js`). Databases and backups from older versions are converted when the server starts. A 4–6 digit PIN has few combinations, so the hash hides PINs from casual reading but would not stop someone with a copy of the database from guessing offline; keep `server/data` and the backup folders private. Five wrong PINs from one device lock it out for 30 seconds, and the lock-out is written to the activity log.
- **Bills:** the server checks line prices against the menu and recalculates tax, discount, tip, change and split payments. A modified browser cannot invent a price or total.
- **Traffic:** plain HTTP by default (see HTTPS above). Use a Wi-Fi password, and ideally a separate guest Wi-Fi without access to other devices. Pages are served with a content-security policy, and only the app files are served (never the database or server code).
- **Single-device mode:** PINs are stored unencrypted in the browser, and anyone who can open the browser's developer tools can read or change the data. Use the server for a real restaurant.
- **Card payments** are only recorded. Nothing connects to a card terminal.

## Not included

- Paying a bill in instalments over time (leaving a balance open). A bill can be split by items or paid by several methods at once.
- Stopping sales when an ingredient runs out is optional (off by default for old data, "warn" for new installs). The check uses the dish's recipe and its options' ingredients; devices that are not sent ingredient figures rely on the server's list, so a dish is marked short only when there is not enough for even one portion.
- Paying a supplier cannot be more than what is owed (there is no advance payment), and there is no multi-currency. Tax on purchases and expenses is only what you type in ("Tax included in the price"); the Tax statement is a worksheet for your accountant, not a tax return.
- Finance has no bank reconciliation, no payroll or tips payout screen (record them as expenses; use the category "Tips paid to staff", which is left out of profit) and no budgets. Sales on account have no due dates, interest or reminders, and a tip cannot be put on account. Cost of goods from recipes covers only dishes that have a recipe.
- Loyalty is one scheme with member levels; there is no per-customer points history screen (the activity log records manual changes) and no birthday or time-limited offers.
- Receipts and kitchen tickets are printed in English: thermal printers often cannot print Myanmar script. Menu and staff names print as you typed them.
- The Myanmar word lists (`js/i18n/my/`) were written without a native review; please have a Myanmar-speaking colleague read it once and edit any word that sounds unnatural.

## Development

```
npm install                 # once; installs jsdom, used only by the browser tests
npm test                    # server tests + browser tests (see the count printed at the end)
npm run test:server         # server tests only (no install needed)
set PORT=3001 && node server\server.js    # run on another port
```

```
index.html              loads the scripts and stylesheets below, in this order
css/                    base.css, layout.css, components/ (forms, modal, receipt, photo…), screens/ (one file per screen), i18n-my.css
js/shared/              rules used by the browser AND the server: core (roles, rounding), bill, inventory (recipes, purchases, stocktake),
                        loyalty, payments, shifts (cash drawer), dataset (demo data). js/shared.js gathers them for Node.
js/finance/             financial statements, pure functions used by the browser and the server: profit-loss, cash-flow, tax, controls,
                        position, daily (the daily close), recurring (monthly expenses), receivables (customer accounts, ageing).
                        js/finance.js gathers them for Node.
js/store/               data model: core (load/save, local mode), orders, guest, shifts, inventory, finance, credit
js/sync/                server mode: core, session (sign-in), push (offline queue), pull (live updates), history (older records), guest, station
js/ui/                  dom helpers, format (money, dates), modal, receipt, print, photo, charts
js/app/                 registry (screens + menu), core (start-up, routing), topbar, live (alerts), session
js/i18n/                engine.js (the translator) and my/ (the Myanmar word list: one file per screen, plus patterns.js)
js/screens/             one file per screen, or one folder when a screen is big (checkout/, customers/, inventory/, order/, products/, settings/, finance/)
js/vendor/qrcode.min.js QR code generator (MIT)
js/dev/ui-audit.js      developer tool: finds text spilling out of cards in a real browser (see its header)
server/server.js        starts the server and wires the pieces together
server/routes/          the /api endpoints: public.js (no sign-in), staff.js, admin.js
server/rules/           business rules for every change: apply.js (version checks, one rule per collection, audit), access.js (who may see
                        what), orders.js, inventory.js, suppliers.js, customers.js, shifts.js, staff.js, catalog.js, settings.js,
                        floor.js, ledger.js (expenses, owner money, daily close), receivables.js (customers paying their accounts), guest.js
server/http/            sending JSON, reading bodies, static files and photos
server/auth.js, realtime.js, network.js   sessions and PIN lock-out, live event streams, addresses and HTTPS
server/db.js, pins.js, backups.js, audit.js, photos.js, make-cert.js
test/client/            the real app clicked through in jsdom (incl. offline queue, dashboard, order history, photos, finance)
server/test/            API, live-sync, security, backup, money, ledger, finance and feature tests
*.bat                   start, auto-start, firewall, counter PC helpers (Windows)
```
