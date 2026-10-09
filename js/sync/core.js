'use strict';

// Server mode: keeps Store.data in sync with the POS server.
// Screens keep editing Store.data and calling Store.save(); save() asks Sync to send whatever documents changed since the
// server last confirmed them. Changes from other devices arrive over an event stream.
// This file holds the connection state and the request helper; the other files in js/sync/ add the parts:
//   session.js (sign-in), push.js (sending changes), pull.js (receiving them), history.js (older records), guest.js (guest menu),
//   station.js (the printer station).

// Server mode: keeps Store.data in sync with the POS server.
// Screens keep editing Store.data and calling Store.save(); save() asks Sync to send whatever documents
// changed since the server last confirmed them. Changes from other devices arrive over an event stream.

const Sync = {
  enabled: false,

  token: null,

  userId: null,

  seq: 0,

  synced: {},        // col -> id -> { ver, json } as last confirmed by the server

  loadedSince: 0,    // orders older than this are fetched on demand (reports, order history)
  ledgerSince: 0,    // purchases, expenses and other money records older than this are fetched on demand (financial statements)

  online: true,

  inflight: false,

  again: false,

  timer: null,

  retryMs: 1000,

  es: null,

  stations: 0,

  addresses: [],

  guestCode: null,

  orderLoads: {},
  ledgerLoads: {},

  async detect() {
    if (!/^https?:$/.test(location.protocol)) return false;
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) return false;
      const h = await res.json();
      this.addresses = h.addresses || [];
      this.stations = h.stations || 0;
      return !!h.server;
    } catch (e) {
      return false;
    }
  },

  // `raw` sends a file as it is (a picture) instead of JSON.
  async api(path, { method = 'GET', body, raw } = {}) {
    const headers = {};
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    if (raw !== undefined) headers['Content-Type'] = raw.type || 'application/octet-stream';
    else if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(path, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch (e) {
      const err = new Error('Cannot reach the POS server. Check the Wi-Fi.');
      err.network = true;
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Server error (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  // Sends a (shrunk) menu picture to the server and returns the name it was stored under.
  async uploadPhoto(blob) {
    return (await this.api('/api/photo', { method: 'POST', raw: blob })).photo;
  },

  emptyData() {
    const data = { version: 1, settings: { name: 'POS', currency: '$', taxRate: 0, serviceRate: 0, receiptFooter: '', printKitchenTickets: false } };
    for (const col of COLLECTIONS) data[col] = [];
    return data;
  },
};
