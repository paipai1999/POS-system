'use strict';

// Network setup: the addresses other devices use to reach this PC, and the optional HTTPS certificate.
const fs = require('fs');
const os = require('os');
const path = require('path');

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
}

// HTTPS is optional: it is used when a certificate and key exist (see README "HTTPS"), otherwise plain HTTP.
function loadTLS() {
  const dir = path.join(__dirname, 'certs');
  const keyFile = process.env.POS_TLS_KEY || path.join(dir, 'key.pem');
  const certFile = process.env.POS_TLS_CERT || path.join(dir, 'cert.pem');
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) return null;
  try { return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }; } catch (e) {
    console.error(`Could not read the HTTPS certificate (${e.message}); starting without HTTPS.`);
    return null;
  }
}

module.exports = { lanAddresses, loadTLS };
