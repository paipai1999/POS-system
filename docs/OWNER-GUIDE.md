# Owner's guide

For the person who owns the restaurant. The README explains how the system is built and installed; this explains how to **run the business on it**: what to look at every day, how to keep the data safe, what to do when something goes wrong, and how to read your numbers. (A Myanmar version is in [OWNER-GUIDE-my.md](OWNER-GUIDE-my.md).)

---

## 1. Every day

### Opening (5 minutes)
1. Start the server on the counter PC (`start-server.bat`) and open the counter (`open-counter.bat`). Check the top bar says **Live**.
2. Look at the top bar for a **⚠ mark** (admins only). Click it: **Settings → System health** says in plain words what needs attention (an old or missing backup, a nearly full disk, someone still on a demo PIN). Fix those first.
3. **Cash drawer → Start shift** and type the cash that is in the drawer.
4. Look at **Inventory** for items marked low. Order what you need before the rush, not during it.
5. Staff press the **clock button** in the top bar when they arrive (and again when they leave). It takes a second and is what the wages and tips figures are built on.

### During service
- Waiters take orders on their phones, the kitchen sees tickets on its own screen, the cashier takes payment. You do not have to be there; the **Dashboard** shows today's sales as they happen.
- Discounts, voids, refunds and **taking sent items off a bill** always need a manager's PIN. That is deliberate: it is what stops food leaving the kitchen without money coming in. Do not share your PIN.

### Closing (10 minutes)
1. **Cash drawer → Close shift**: count the cash. The POS shows the difference against what should be there. A difference is written in the activity log, so a pattern (always short on one person's shift) is visible.
2. **Finance → Daily close** for the day. It locks the day so nobody can quietly change yesterday's figures.
3. Look at the **Dashboard** for the day's total, and at **Cash drawer** for whether the count matched.
   Managers: if **Hours** shows a *no clock-out* warning, correct it now while people remember when they left.
4. Leave the server PC **on** (backups run while it is on) and the server window **open**.

---

## 2. Keeping your data safe

Your sales history, stock, customers and staff accounts all live in one file, `server/data/pos.db`, on the counter PC. If that PC's disk dies and you have no other copy, **the business records are gone**. Everything below is about making sure that cannot happen.

### What the POS does for you
- A copy is saved **every day** in `server/data/backups` (the newest 30 are kept).
- Every copy is **opened and checked** as soon as it is made. A copy that does not pass is thrown away and reported, and you see a red ⚠ mark.

### What you must do once
**Settings → Data & backup → Backup folders.** Add a USB drive and/or a folder that syncs to the cloud (OneDrive, Google Drive, Dropbox). Until you do, **System health** keeps telling you that every backup is on the same disk as the data, because that is not safe.

> Rule of thumb: **three copies, two kinds of storage, one in another place.** The live data, the daily copy on the PC, and a copy on a USB drive or in the cloud that you take home or that syncs by itself.

### Test your backups (once a month, 10 minutes)
A backup you have never restored is a hope, not a backup.
1. Close the server window.
2. Double-click `restore-backup.bat`. It lists every copy it can find, newest first, with how many orders each holds and whether it is damaged.
3. Drag one copy onto `restore-backup.bat` (or type its path after the command), and type **YES**. The data that was in place is first saved as `before-restore-<date>.db`, so you can undo.
4. Start the server, sign in, and look at yesterday's sales. If they are there, your backups work.

(If you would rather not touch the live data, do this drill on any other PC with the same files: copy the folder, put a backup in `server/data/pos.db`, and start the server.)

### If the counter PC is lost or dead
1. On another Windows PC, install Node.js (LTS) from nodejs.org and copy the POS folder (from the cloud/USB copy of the program, or from GitHub).
2. Plug in the USB drive / open the synced folder and run `restore-backup.bat` to see the copies.
3. Restore the newest one that is not damaged. Menu pictures come back from the `photos` folder next to the copies.
4. Give the new PC the old PC's address in your router (DHCP reservation), or re-print the table QR codes if the address changes.
5. Re-run `allow-firewall.bat` as administrator, and mark the printer station again in Settings.

Typical time: 30–60 minutes. You lose only what happened since the last copy (at most a day, less if you also use **Export backup** at closing).

### Moving data
**Settings → Export backup** downloads everything as one file. Use it before big changes (new menu, new prices) and when moving between PCs. **Import backup** puts it back (all devices reload).

---

## 3. When something goes wrong

| What you see | What to do |
|---|---|
| Top bar says **Offline** | Wi-Fi dropped, or the server PC is off. The device keeps working and sends changes when it is back. Do not close the page while it says *Offline · N waiting*. |
| Nobody can open the POS | On the server PC: is the server window open? If not, run `start-server.bat`. If the PC restarted, set up auto-start (`install-autostart.bat`). |
| Phones cannot reach the server | The PC's address changed (set a DHCP reservation in the router), the Wi-Fi network is marked *Public* in Windows (change to *Private*), or the firewall rule is missing (`allow-firewall.bat` as administrator). |
| "Too many wrong PINs" | Five wrong PINs lock **that person's sign-in** for 30 seconds, then 1, 2 and 5 minutes if it keeps happening, whichever device it is typed on. Wait it out. People already signed in are not affected. If it keeps happening and nobody on your team is typing, someone else is guessing: see **Activity log**, which shows the address. |
| Receipt does not print | **Settings → Printing → Print test page** on the counter PC. Check the printer station is ticked, the paper size is 80 mm and margins are *None*. |
| ⚠ **No backup** / **backup damaged** | Settings → Data & backup → **Back up now**. If it still fails, check free disk space (System health) and that the USB drive is plugged in. |
| ⚠ **Low disk space** | Free space on the PC (empty the recycle bin, remove old downloads). The POS database itself is small; photos and Windows updates are usually the cause. |
| Someone forgot their PIN | **Staff → edit → type a new PIN** (4–6 digits, not used by anyone else) and tell them privately. |
| Wrong data after a mistake | Do not panic and do not reset. Use **Activity log** to see what changed and who did it, and restore a backup only if you must (section 2). |

---

## 4. Security checklist (review monthly)

- [ ] **Nobody uses a demo PIN.** (1234, 1111, 2222, 3333.) The POS refuses to let them work, but check **System health** says no one is still on one.
- [ ] **Each person has their own PIN** and does not share it. Rename accounts to real names.
- [ ] **Staff who left are deactivated** (Staff → edit → untick *Active*). Their sessions end at once. Never delete them: their sales history must stay accurate.
- [ ] **Roles are right.** Waiters and cashiers do not need Admin. *Manager* can approve discounts, voids and refunds; *Admin* can also change settings, staff, and download all data.
- [ ] **Read the Activity log** (Settings → Activity log) once a week: price changes, stock changes, voids, refunds, discounts, sent items taken off bills, shift differences, locked accounts. Ask about anything you do not recognise.
- [ ] **Backups are off the PC** (section 2) and you did the monthly restore drill.
- [ ] **The server PC is private**: Windows password set, nobody else uses it, and its disk is not shared. Backups contain PIN hashes and all sales; keep USB drives private.
- [ ] **Guest Wi-Fi is separate** from the Wi-Fi the POS devices use, if your router supports it. Guests then cannot reach the POS at all.
- [ ] **Optional but good: HTTPS** (README → HTTPS).

---

## 5. Reading your numbers

### Every week (15 minutes, for example Monday morning)
- **Finance → Business health**, period *Last month* or *This month*. Three numbers matter most, each shown as a share of your sales with a verdict (good / watch / too high):
  - **Food cost**: what the ingredients of the dishes sold cost. Restaurants usually run at about 28–35%. If it is high: check portion sizes, waste and supplier prices, and whether the recipes in the POS are right.
  - **Labour**: wages and salaries, usually 25–35%. If it is high: look at **Sales patterns** below and cut hours in the slow hours, not in the busy ones.
  - **Prime cost** (food + labour): the figure to watch hardest. Under about 60% is comfortable; over about 68% leaves little for rent and profit.
  - **Break-even**: the sales you need *per day* to cover the month's running costs, and how far sales could fall before you lose money.
  - The screen warns you when a figure cannot be trusted: too few dishes have a recipe (food cost looks better than it is), or no salaries are recorded (labour looks better than it is). Fix the cause rather than trusting the number.
- **Finance → Sales patterns**: which weekdays and hours are busy and which are slow, dine-in against takeaway, which tables and which servers sell most. Use it to decide who works when, and when a promotion makes sense.
- **Finance → Menu engineering**: every dish as a **star** (keep and promote), **plowhorse** (popular but thin margin: raise the price a little or trim the recipe), **puzzle** (profitable but rarely ordered: move it up the menu, rename it, have the staff suggest it) or **dog** (rework or drop). Dishes with no recipe are listed as unknown, so add the recipe first.
- **Finance → Receivables**: who owes you money and for how long. Phone anything over 30 days.

### Staff hours and tips (weekly, before you pay)
- Everyone presses the **clock button** in the top bar when they start and finish. The time is the server's, so nobody can type longer hours.
- **Hours** (managers and the owner): the week or month by person, with who is on shift now. If a **"no clock-out"** warning shows, someone forgot to clock out: press *Edit* on that shift and type the time they really left. Until you do, that shift counts for nothing (the POS will not guess pay for you). You can also *Add a shift* nobody clocked, or correct one; every change is written to the activity log.
- Set each person's **hourly pay** under *Staff → Edit* (only you, the admin, can, and only managers and that person can see it). The Hours screen then shows wages, and **Business health** can estimate labour from the hours until you record real salaries as expenses. Wages are hours × pay, before any tax or deduction: they are an aid for payroll, not payroll itself. *Export CSV* gives a file to check against your own payroll.
- **Tips** (same screen): the tips collected, what has been paid out and what is still to pay. Each person's **own tips** are the tips on the bills they took; **shared by hours** divides the whole pool by hours worked, which is fairer when waiters, cashiers and kitchen share the work. Choose the way your team agrees, pay the tips, and record the payment under *Finance → Expenses* in the category **Tips paid to staff** (it is not a cost of the restaurant, so it does not reduce your profit).

### Every month
- **Record the salaries** as an expense (*Finance → Expenses*; make it a repeating expense so it records itself). Until you do, labour and net profit are flattering.
- **Daily close** is done every day; at month end check **Finance → Profit & loss** and keep the CSV.
- **Several shops?** On the last day of the month save a backup from **each** branch (*Settings → Export backup*), bring the files to one computer and open *Finance → Branches*. Add the files and read the table: sales, share, average bill, food cost, labour and net profit per shop, with the best margin marked. Check for the yellow warning *"the last sale in this backup is from…"*: it means that backup was saved before the month ended, so save a fresh one. Two files with the same shop name are flagged: one shop saved twice would be counted twice. The files are read in the browser only and are not kept.

### Bookings, deposits and wallets
- **Reservations**: take bookings in *Reservations* (the table map shows who is coming in the next two hours); *Seat* opens the bill. A guest who has not arrived 15 minutes after the time is shown as late; mark a no-show to free the table.
- **Deposits**: take a deposit from the customer (or from the booking) and it is kept as **credit on their account**, not as sales, so your profit is right until the meal happens. At checkout use *On account* to spend it. A deposit you give back needs a manager's PIN.
- **Wallets** (KBZPay, Wave Pay, bank transfer): the cashier chooses *Other* and the wallet name. At the end of the day compare each wallet's total in the reports with that wallet's own app; a difference is the first sign of a wrong entry.

---

## 6. Hardware that saves you

- **A small UPS** (battery backup) for the server PC and the router: a power cut should not corrupt the database or stop the Wi-Fi.
- **A spare cheap Android phone or tablet** as a standby waiter/kitchen device.
- **The router's DHCP reservation** for the server PC (so addresses never change).
- **A receipt printer you have tested** with Myanmar text, and a spare roll in the drawer.
