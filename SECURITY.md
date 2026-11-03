# Security policy

This POS handles money, staff PINs and customer phone numbers, so security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private reporting instead:
*Security → Report a vulnerability* on this repository.

Include what an attacker can do, the steps to reproduce, and the version (`package.json` or *Settings → System health*). You'll get a reply within 7 days, and a fix or a plan within 30 days for confirmed issues. Credit is given in the release notes unless you prefer otherwise.

## Supported versions

Only the latest release gets security fixes.

## Scope

In scope: the server (`server/`), the API, PIN handling and lock-out, role permissions (what each role can read or change), bill and payment validation, backups and restore, static file serving.

Known limits that are documented, not bugs:
- Single-device mode (opening `index.html` directly) stores PINs unhashed in the browser.
- Traffic is plain HTTP unless HTTPS is set up (`node server/make-cert.js`).
- 4–6 digit PINs can be guessed offline by someone who already has a copy of the database.
