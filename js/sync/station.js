'use strict';

// The counter PC registers as the printer station; other devices send it bills, receipts and kitchen tickets.
// It works while nobody is signed in on the counter, using a device key an admin created.
const Station = {
  key: null,
  es: null,
  queue: [],
  busy: false,

  init() {
    try { this.key = localStorage.getItem('pos-station-key'); } catch (e) { this.key = null; }
  },

  get active() { return !!this.key && Store.server; },

  start() {
    this.stop();
    if (!this.active) return;
    const es = new EventSource('/api/station/events?key=' + encodeURIComponent(this.key));
    this.es = es;
    es.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type === 'jobs') m.rows.forEach(r => this.handle(r));
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setTimeout(() => { if (this.es === es) this.start(); }, 5000);
    };
  },

  stop() {
    if (this.es) this.es.close();
    this.es = null;
  },

  async handle(row) {
    const job = row.data;
    if (row.deleted || !job || job.status !== 'pending' || Date.now() - job.createdAt > 15 * 60 * 1000) return;
    try {
      await this.post(job.id, 'printing'); // fails if another station already took it
    } catch (e) {
      return;
    }
    this.queue.push(job);
    this.drain();
  },

  drain() {
    if (this.busy || !this.queue.length) return;
    const job = this.queue.shift();
    this.busy = true;
    setTimeout(() => {
      printLocal(cleanPrintHTML(job.html), job.kind === 'sheet');
      this.post(job.id, 'done').catch(() => {});
      this.busy = false;
      this.drain();
    }, 50);
  },

  post(id, status) {
    return fetch('/api/station/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: this.key, id, status }),
    }).then(r => { if (!r.ok) throw new Error('rejected'); });
  },

  async enable() {
    const r = await Sync.api('/api/station/register', { method: 'POST' });
    this.key = r.key;
    try { localStorage.setItem('pos-station-key', r.key); } catch (e) { /* ignore */ }
    this.start();
  },

  async disable() {
    try { await Sync.api('/api/station/unregister', { method: 'POST', body: { key: this.key } }); } catch (e) { /* ignore */ }
    this.stop();
    this.key = null;
    try { localStorage.removeItem('pos-station-key'); } catch (e) { /* ignore */ }
  },
};
