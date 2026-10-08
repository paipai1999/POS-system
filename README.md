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
- **Purchases** (*Inventory → Purchases*): record stock you buy (supplier, amount, price paid). The amount goes into stock and each ingredient's cost moves to the weighted average of what you paid. A manager can void a purchase entered by mistake.
- **Stocktake** (*Inventory → Stocktake*): type what you counted on the shelves; stock is set to your count and the difference, with its value at cost, is kept as a record. Menu items with stock tracking can be counted too.
- **Customers & loyalty** (*Customers*): a customer list with phone, points, total spent and visits. At checkout, *Choose customer* (or add a new one on the spot). With loyalty switched on in *Settings* (admin), a paid bill earns the customer a percentage of the total as points, and a later bill can be paid partly with points (1 point = 1 unit of money, up to a set share of the bill). A manager can also give a customer a standing discount, which is applied automatically without asking for a manager PIN each time. A refund takes the points back. The receipt shows points used, earned and the balance.
- **Menu & stock**: items, categories, emoji icons, options, on/off sale toggle. Stock is reserved on open orders and deducted at payment, with low-stock alerts. An order cannot claim more than is left.
- **Reports**: sales, net, tax, discounts, refunds, tips, ingredient cost and profit on items that have a recipe, purchases, best sellers, and sales by category, payment method, server and hour. CSV export.
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
| Staff, settings (incl. loyalty), activity log, backups | ✓ |   |   |   |   |
| Inventory, recipes and costs, purchases, stocktake | ✓ | ✓ |   |   |   |
| Customers: add, choose at checkout, use points | ✓ | ✓ | ✓ |   |   |
| Set a customer's points or standing discount | ✓ | ✓ |   |   |   |

In multi-device mode the server enforces these rules, and also what each role is sent: a waiter's phone never receives other people's payments, the kitchen screen never receives prices, and only managers receive ingredients, recipes, costs and purchases (cashiers see customers, because they take payment; waiters do not).

## Security notes

- **PINs:** checked on the server, never sent to phones, and stored only as salted hashes (`server/pins.js`). Databases and backups from older versions are converted when the server starts. A 4–6 digit PIN has few combinations, so the hash hides PINs from casual reading but would not stop someone with a copy of the database from guessing offline; keep `server/data` and the backup folders private. Five wrong PINs from one device lock it out for 30 seconds, and the lock-out is written to the activity log.
- **Bills:** the server checks line prices against the menu and recalculates tax, discount, tip, change and split payments. A modified browser cannot invent a price or total.
- **Traffic:** plain HTTP by default (see HTTPS above). Use a Wi-Fi password, and ideally a separate guest Wi-Fi without access to other devices. Pages are served with a content-security policy, and only the app files are served (never the database or server code).
- **Single-device mode:** PINs are stored unencrypted in the browser, and anyone who can open the browser's developer tools can read or change the data. Use the server for a real restaurant.
- **Card payments** are only recorded. Nothing connects to a card terminal.

## Not included

- Paying a bill in instalments over time (leaving a balance open). A bill can be split by items or paid by several methods at once.
- Selling is never blocked when an ingredient has run out (the food was served anyway); running low is shown in Inventory and Reports instead.
- Priced options (extra shot…) do not use extra ingredients yet, only the item's recipe is used. Suppliers are typed names, not a separate list. Loyalty is one simple scheme (earn %, spend up to a %), with no tiers or expiry.
- Receipts and kitchen tickets are printed in English: thermal printers often cannot print Myanmar script. Menu and staff names print as you typed them.
- The Myanmar word list (`js/i18n-my.js`) was written without a native review; please have a Myanmar-speaking colleague read it once and edit any word that sounds unnatural.

## Development

```
npm install                 # once; installs jsdom, used only by the browser tests
npm test                    # server tests + browser tests (83 tests)
npm run test:server         # server tests only (no install needed)
set PORT=3001 && node server\server.js    # run on another port
```

```
index.html
css/styles.css
js/shared.js          roles, demo data, bill/payment/stock/recipe/purchase/loyalty rules (used by the browser AND the server)
js/store.js           data model, local mode (localStorage)
js/sync.js            server mode: snapshot, live updates, offline queue, printer station
js/ui.js              modal, toasts, PIN prompts, receipts, printing
js/i18n.js, i18n-my.js   Myanmar interface (word list + rules)
js/app.js             start-up, routing, top bar, permissions, live alerts
js/screens/*.js       one file per screen
js/vendor/qrcode.min.js   QR code generator (MIT)
server/server.js      HTTP server, API, live event streams, security headers
server/sync.js        server-side rules: permissions, versions, bills, stock, shifts, guests
server/db.js          SQLite storage, sessions, audit log
server/pins.js        PIN hashing, demo-PIN detection
server/backups.js     daily copies + USB/cloud folders
server/audit.js       what goes into the activity log
server/make-cert.js   makes a self-signed HTTPS certificate
test/client/          the real app clicked through in jsdom (incl. offline queue)
server/test/          API, live-sync, security, backup, money and feature tests
*.bat                 start, auto-start, firewall, counter PC helpers (Windows)
```
