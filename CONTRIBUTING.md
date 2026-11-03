# Contributing

Thanks for helping. This POS is used by small restaurants and cafes, so the bar is: **a bill must never come out wrong, and data must never be lost.**

## Ways to help

- **Try it in a real shop** and open an issue with what was confusing or broke (photos of receipts are welcome).
- **Myanmar translation review.** The word lists in `js/i18n/my/` were never read by a native speaker. Fixing an unnatural phrase is a great first PR.
- **Other languages.** Thai, Vietnamese, Khmer, Bahasa… copy `js/i18n/my/` as a starting point and open an issue first so we agree on the structure.
- **Printers.** Tell us which 80 mm receipt printer you used and whether the test page (*Settings → Printing*) came out right.
- **Bugs and features** — see the issue templates.

## Development setup

You need Node.js **22.5 or newer**. There are no runtime dependencies; `jsdom` is used only by the browser tests.

```bash
git clone https://github.com/paipai1999/POS-system.git
cd POS-system
npm install       # dev dependency for browser tests
npm test          # all tests (server + browser), takes 2–3 minutes
npm start         # http://localhost:3000
```

Sign in with the demo PIN `1234` (Admin). You will be asked to choose a new PIN.

## Rules for changes

1. **Money and stock rules live in `js/shared/` and `js/finance/`.** They run in both the browser and the server. Don't duplicate a rule in only one place.
2. **The server never trusts the browser** for prices, totals, times or permissions. If you add a field that affects money, recalculate or validate it in `server/rules/`.
3. **Add a test.** Server behaviour goes in `server/test/`, real-app clicks go in `test/client/`. A PR that changes money, stock, permissions or backups without a test will be asked for one.
4. **Every visible string needs a Myanmar entry** in `js/i18n/my/` (an English fallback is fine if you don't speak Myanmar — say so in the PR).
5. Keep it dependency-free at runtime. No build step.
6. `npm test` must pass.

## Pull requests

- One topic per PR, with a short description of what a shop owner would notice.
- Screenshots for UI changes.
- Don't commit anything from `server/data/` (real sales data).

## Code of conduct

Be kind and patient. Many users and contributors are not native English speakers.
