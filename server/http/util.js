'use strict';

// HTTP helpers every route uses: the error type, security headers, reading a request body and sending JSON.

// Thrown by routes; the server turns it into a JSON reply { error } with this status.
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Sent with every response. The page policy only allows scripts from this server, which also stops injected markup from running.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

function sendJSON(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// The raw request body, refused with 413 when it is larger than `limit` bytes.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, over = false;
    req.on('data', c => {
      size += c.length;
      if (over) return;                                   // keep reading (and dropping) so the sender gets the answer instead of a cut line
      if (size > limit) { over = true; chunks.length = 0; reject(new HttpError(413, 'Request too large')); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSON(req, limit = 2e6) {
  const buf = await readBody(req, limit);
  try { return buf.length ? JSON.parse(buf.toString('utf8')) : {}; }
  catch (e) { throw new HttpError(400, 'Invalid JSON'); }
}

module.exports = { HttpError, SECURITY_HEADERS, PAGE_CSP, sendJSON, readBody, readJSON };
