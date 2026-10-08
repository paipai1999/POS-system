'use strict';

// Runs the real web app (index.html + js/*) in jsdom against a real POS server, and lets a test click through it.
// jsdom lacks fetch, EventSource and printing, so small stand-ins are provided; the network can be switched off
// to test the offline queue.
const fs = require('fs');
const os = require('os');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* tests are skipped when jsdom is not installed */ }

const { start } = require('../../server/server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(fn, { timeout = 5000, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = fn(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`Timed out waiting for ${what}`);
    await sleep(25);
  }
}

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-client-'));
  const app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    app, base, dataDir,
    async stop() {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// One browser tab. `net.up = false` makes every request fail like a dropped Wi-Fi connection.
async function openApp(base, { apiDown = false, lang = null } = {}) {
  const net = { up: true, apiDown };
  const prints = [];
  const dom = await JSDOM.fromURL(base + '/', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = async (url, opts = {}) => {
        const u = new URL(url, base);
        if (!net.up || (net.apiDown && u.pathname.startsWith('/api/'))) throw new TypeError('Failed to fetch');
        return fetch(u, { ...opts, signal: undefined });
      };
      window.EventSource = class {
        static get CLOSED() { return 2; }
        constructor(url) {
          this.readyState = 0;
          this.ctl = new AbortController();
          this.open(new URL(url, base));
        }
        async open(u) {
          try {
            if (!net.up) throw new Error('offline');
            const res = await fetch(u, { signal: this.ctl.signal });
            if (!res.ok) throw new Error('refused');
            this.readyState = 1;
            const dec = new TextDecoder();
            let buf = '';
            for await (const chunk of res.body) {
              buf += dec.decode(chunk, { stream: true });
              let i;
              while ((i = buf.indexOf('\n\n')) >= 0) {
                const line = buf.slice(0, i).split('\n').find(l => l.startsWith('data: '));
                buf = buf.slice(i + 2);
                if (line && this.onmessage) this.onmessage({ data: line.slice(6) });
              }
            }
          } catch (e) { /* closed or dropped */ }
          if (!this.ctl.signal.aborted) { this.readyState = 2; if (this.onerror) this.onerror(new Error('stream closed')); }
        }
        close() { this.readyState = 2; this.ctl.abort(); }
      };
      window.print = () => prints.push(window.document.querySelector('#print-area').innerHTML);
      window.scrollTo = () => {};
      window.alert = () => {};
      if (lang) { try { window.localStorage.setItem('pos-lang', lang); } catch (e) { /* ignore */ } }
    },
  });
  const w = dom.window;
  await until(() => w.eval('typeof App !== "undefined" && App.screen'), { what: 'the app to start' });
  const doc = w.document;

  const tab = {
    w, doc, net, prints,
    get: expr => w.eval(expr),
    $: sel => doc.querySelector(sel),
    $$: sel => [...doc.querySelectorAll(sel)],
    text: sel => { const e = doc.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; },
    click(sel) {
      const el = typeof sel === 'string' ? doc.querySelector(sel) : sel;
      if (!el) throw new Error(`Nothing to click: ${sel}`);
      el.click();
    },
    type(sel, value) {
      const el = typeof sel === 'string' ? doc.querySelector(sel) : sel;
      if (!el) throw new Error(`No such field: ${sel}`);
      el.value = value;
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
    },
    key(k) { doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true })); },
    until,
    sleep,
    toasts: () => tab.$$('.toast').map(t => t.textContent),
    modalTitle: () => tab.text('.modal-head h2'),
    screen: () => w.eval('App.screen'),
    close() { dom.window.close(); },

    // Taps a name and the PIN on the keypad, like a person would.
    async pressPin(name, pin) {
      const id = w.eval(`(Store.data.users.find(u => u.name === ${JSON.stringify(name)}) || {}).id`);
      const t = tab.$(`.user-tile[data-id="${id}"]`); // by id: the name on the tile may be shown in Myanmar
      if (!t) throw new Error(`No sign-in tile for ${name}`);
      t.click();
      for (const d of pin) tab.click(`[data-key="${d}"]`);
      tab.click('[data-key=ok]');
    },

    // Signs in; a demo PIN asks for a new one, which is entered too.
    async signIn(name, pin, newPin = null) {
      await tab.pressPin(name, pin);
      await until(() => w.eval('!!App.user'), { what: `${name} to sign in` });
      if (newPin) {
        await until(() => tab.modalTitle() === 'Choose your own PIN', { what: 'the PIN change dialog' });
        tab.type('[name=pin]', newPin);
        tab.type('[name=again]', newPin);
        tab.click('.modal [data-act=save]');
        await until(() => !w.eval('Modal.isOpen'), { what: 'the PIN change to finish' });
      }
    },
  };
  return tab;
}

module.exports = { JSDOM, startServer, openApp, until, sleep };
