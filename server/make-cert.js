'use strict';

// Creates a self-signed HTTPS certificate for this PC (needs OpenSSL, which comes with Git for Windows).
// Usage:  node server/make-cert.js [output folder]     (default: server/certs)
// The server uses HTTPS automatically when key.pem and cert.pem are in that folder.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, 'certs'));
const lan = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
const san = ['DNS:localhost', 'IP:127.0.0.1', ...lan.map(a => 'IP:' + a)].join(',');

const candidates = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe'];
fs.mkdirSync(outDir, { recursive: true });
let done = false;
for (const bin of candidates) {
  const r = spawnSync(bin, [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
    '-keyout', path.join(outDir, 'key.pem'), '-out', path.join(outDir, 'cert.pem'),
    '-subj', '/CN=Restaurant POS', '-addext', `subjectAltName=${san}`,
  ], { encoding: 'utf8' });
  if (r.error) continue; // this OpenSSL is not installed here; try the next
  if (r.status !== 0) {
    console.error(r.stderr || 'OpenSSL failed');
    process.exit(1);
  }
  done = true;
  break;
}
if (!done) {
  console.error('\n  OpenSSL was not found. Install "Git for Windows" (https://git-scm.com), which includes it, and run this again.\n');
  process.exit(1);
}
console.log(`\n  Certificate created in ${outDir}`);
console.log(`  Valid for: ${['localhost', '127.0.0.1', ...lan].join(', ')}`);
console.log('  Restart the POS server. Devices will show a one-time "not private" warning: choose Advanced, then Continue.');
console.log('  If this PC\'s address changes, run this again.\n');
