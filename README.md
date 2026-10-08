# Restaurant POS

A point-of-sale system for restaurants and cafes. It runs in two ways:

- **Multi-device (recommended).** One PC runs the POS server. The counter PC, waiters' phones, a kitchen screen and guests' phones all use it over the restaurant Wi-Fi and stay in sync live.
- **Single device.** Double-click `index.html`. Everything is saved in that browser only, and no server is needed.

## Multi-device setup

You need [Node.js](https://nodejs.org) 22.5 or newer on the PC that runs the server. There is nothing else to install.

1. **Start the server.** On the counter PC, double-click `start-server.bat`. It shows the address to use, for example:
   ```
   On this PC:     http://localhost:3000
   Other devices:  http://192.168.1.20:3000
   ```
   Keep that window open while the restaurant is using the POS.
2. **Allow it through the firewall.** The first time, Windows asks whether Node.js may use the network. Allow it on **Private networks**.
3. **Fix the PC's address.** In your Wi-Fi router, reserve this PC's IP address (often called a "DHCP reservation"). If the address changes, the other devices and the table QR codes stop finding the server.
4. **Set up the counter PC.**
   - Double-click `open-counter.bat`. It opens the POS in Chrome so that it prints without the print dialog.
   - Sign in as Admin, open **Settings**, and tick **"This device is the printer station"**.
   - Bills, receipts and kitchen tickets sent from phones now print here, even while nobody is signed in on the counter.
5. **Phones and tablets.** On the restaurant Wi-Fi, open the "Other devices" address and add it to the home screen.
6. **Kitchen screen.** Open the same address on a tablet in the kitchen and sign in as **Kitchen** (PIN 3333).
7. **Table QR codes.**
   - Go to **Settings → Tables → Print table QR codes** and put one on each table.
   - Guests scan the code, browse the menu, order, and call a waiter, all from their own phone.
   - Guests must be on the restaurant Wi-Fi, because the server is not on the internet.

### How an order flows

1. A guest scans the table QR code, or a waiter takes the order.
2. The waiter's phone gets a 🔔 alert and they accept the order.
3. The waiter taps **Send**. The order appears on the **kitchen screen**, and a kitchen ticket prints at the counter if that option is on in Settings.
4. The cook taps **Ready**. The waiter's phone beeps and vibrates, and the table shows 🍽️ until they tap **Served**.
5. The waiter taps **Print bill**, which prints at the counter. The cashier takes payment, and the table becomes free on every device.

### If the Wi-Fi drops

Devices keep working. The top bar shows **Offline · N waiting**, and changes are sent automatically when the connection returns. Don't reload or close the page while it shows Offline.

### Data and backups

- **Where data is stored:** `server/data/pos.db`.
- **Automatic backups:** a copy is saved every day in `server/data/backups`, and the newest 30 are kept.
- **Moving data:** **Settings → Export / Import backup** moves data between machines. Use it to move from single-device mode to the server.

## Demo logins

| Staff   | Role    | PIN  |
|---------|---------|------|
| Admin   | Admin   | 1234 |
| Maya    | Cashier | 1111 |
| Leo     | Waiter  | 2222 |
| Kitchen | Kitchen | 3333 |

Change these under **Staff** before real use.

## Features

- **Tables & takeaway**: table map with live totals, how long each table has been open, the assigned server, and move-table.
- **Ordering**: category and search menu, quantities, per-item kitchen notes, and order notes.
- **Kitchen display**: live ticket queue with timers that turn amber after 10 minutes and red after 20. **Ready** notifies the waiter. Printed kitchen tickets are optional.
- **Checkout**: % or fixed discount (manager approval), tax, optional service charge, and cash/card/other payment. Cash shows quick-cash buttons and the change due.
- **Receipts**: 80 mm receipts and pre-bills. In multi-device mode they print at the counter's printer station.
- **Menu & stock**: items, categories, emoji icons and an on/off sale toggle. Stock is reserved on open orders and deducted at payment, with low-stock alerts.
- **Reports**: sales, net, tax, discounts, refunds, best sellers, and sales by category, payment method, server and hour. CSV export.
- **Staff & roles**: Admin, Manager, Cashier, Waiter and Kitchen, each with their own PIN.
- **Guest ordering**: on the guest's own phone via the table QR code, or on a restaurant tablet in guest mode. Waiters accept requests into the table's order.

## Roles

| Permission                        | Admin | Manager | Cashier | Waiter | Kitchen |
|-----------------------------------|:-----:|:-------:|:-------:|:------:|:-------:|
| Tables, orders, guest requests    | ✓ | ✓ | ✓ | ✓ (own orders) |   |
| Kitchen display                   | ✓ | ✓ |   |   | ✓ |
| Take payments                     | ✓ | ✓ | ✓ |   |   |
| Approve voids, refunds, discounts | ✓ | ✓ |   |   |   |
| Menu & stock, reports             | ✓ | ✓ |   |   |   |
| Staff & settings                  | ✓ |   |   |   |   |

In multi-device mode the server enforces these rules. A waiter's phone cannot take a payment or change settings even if someone tampers with the page.

## Security notes

- **PINs:** they are checked on the server, never sent to phones or tablets, and stored only as salted hashes (`server/pins.js`). Databases and backups from older versions are converted when the server starts. Note that a 4–6 digit PIN has few combinations, so the hash hides PINs from casual reading but would not stop someone with a copy of the database from guessing them offline; keep the database and backup folder private. Five wrong PINs from one device lock it out for 30 seconds.
- **Unencrypted traffic:** connections use plain HTTP inside your network. Use a Wi-Fi password, and ideally a separate guest Wi-Fi without access to other devices.
- **Single-device mode:** PINs are stored unencrypted in the browser.
- **Card payments** are only recorded. Nothing connects to a card terminal.

## Development

```
node --test "server/test/*.test.js"      # server API tests
set PORT=3001 && node server\server.js    # run on another port
```

```
index.html
css/styles.css
js/shared.js          roles, demo data, dataset checks (used by the browser and the server)
js/store.js           data model, totals, stock (local mode: localStorage)
js/sync.js            server mode: snapshot, live updates, offline queue, printer station
js/ui.js              modal, toasts, PIN prompt, receipts, printing
js/app.js             start-up, routing, top bar, permissions, live alerts
js/screens/*.js       one file per screen
js/vendor/qrcode.min.js   QR code generator (MIT)
server/server.js      HTTP server, API, live event streams
server/sync.js        server-side rules: permissions, versions, order numbers, stock, guest requests
server/db.js          SQLite storage, sessions, backups
```
