'use strict';

// The server uses node:sqlite, which arrived in Node 22.5. Fail with a clear message instead of a stack trace.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`\n  This POS server needs Node.js 22.5 or newer, but this PC has ${process.version}.`);
  console.error('  Download the current "LTS" version from https://nodejs.org, install it, then start the server again.\n');
  process.exit(1);
}
