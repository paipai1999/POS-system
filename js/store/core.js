'use strict';

// The app's data in the browser. Local mode keeps everything in localStorage; server mode keeps a copy that js/sync/ keeps current.
// This file holds the data itself, loading/saving and the lookups; the other files in js/store/ add the operations by area
// (orders, shifts, inventory, guest requests, finance).

// Local mode: all data lives in localStorage under one key (opening index.html directly).
// Server mode: data comes from the POS server and every save() is synced by Sync (js/sync/).
const STORE_KEY = 'restaurant-pos-v1';

const Store = {
  data: null,

  mode: 'local',

  get server() { return this.mode === 'server'; },

  load() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { data = null; }
    if (this.isValid(data)) {
      this.data = this.normalize(data);
      // Open orders left empty (e.g. the tab was closed on the order screen) would show a table as busy forever.
      this.data.orders = this.data.orders.filter(o => o.status !== 'open' || o.items.length);
    } else {
      this.data = seedData();
      this.save();
    }
  },

  // Fills in fields that older or hand-edited backups may lack.
  normalize(data) {
    normalizeDataset(data);
    const defaults = seedData().settings;
    data.settings = { ...defaults, ...data.settings };
    const maxNo = data.orders.reduce((m, o) => Math.max(m, Number(o.number) || 0), 0);
    data.settings.nextOrderNo = Math.max(Number(data.settings.nextOrderNo) || 1, maxNo + 1); // never reuse an order number
    this.sortCategories(data);
    return data;
  },

  // Applies a change made by another tab. Returns false (keeping current data) if the new value is unusable,
  // so a cleared or corrupt storage entry in one tab cannot wipe the data in another.
  syncFrom(raw) {
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!this.isValid(data)) return false;
    this.data = this.normalize(data);
    return true;
  },

  save() {
    if (this.server) return Sync.schedule();
    // Single-device mode: keep each dish's "short of …" list current (the server does this itself in server mode).
    if (this.data.ingredients.length) refreshLacks(this.data.products, id => this.ingredient(id));
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    } catch (e) {
      alert('Could not save data: browser storage is full or blocked. Export a backup and clear old orders.');
    }
  },

  isValid(d) { return isValidDataset(d); },

  reset() { this.data = seedData(); this.save(); },

  replace(data) {
    this.data = this.normalize(data);
    this.save();
  },

  get settings() { return this.data.settings; },

  user(id) { return this.data.users.find(u => u.id === id); },

  product(id) { return this.data.products.find(p => p.id === id); },

  category(id) { return this.data.categories.find(c => c.id === id); },

  table(id) { return this.data.tables.find(t => t.id === id); },

  order(id) { return this.data.orders.find(o => o.id === id); },

  ingredient(id) { return this.data.ingredients.find(i => i.id === id); },

  customer(id) { return this.data.customers.find(c => c.id === id); },

  supplier(id) { return this.data.suppliers.find(s => s.id === id); },

  userByPin(pin) { return this.data.users.find(u => u.active && u.pin === pin); },

  sortCategories(data = this.data) {
    data.categories.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  },

  // PINs are only checked locally in local mode; in server mode the server checks them and never sends them out.
  async login(userId, pin) {
    if (this.server) return Sync.login(userId, pin);
    const user = this.user(userId);
    if (!user || !user.active || user.pin !== pin) throw new Error('Incorrect PIN');
    return user;
  },

  async verifyPin(pin) {
    if (this.server) return Sync.verifyPin(pin);
    const user = this.userByPin(pin);
    if (!user) throw new Error('Wrong PIN');
    return user;
  },

  // PINs that ship with the demo data. A user who signs in with one is asked to choose their own.
  DEMO_PINS: ['1234', '1111', '2222', '3333'],

  mustChangePin(user) {
    if (!user) return false;
    return this.server ? !!Sync.mustChangePin : this.DEMO_PINS.includes(user.pin);
  },

  async changeOwnPin(pin) {
    if (this.server) {
      await Sync.api('/api/me/pin', { method: 'POST', body: { pin } });
      Sync.mustChangePin = false;
      return;
    }
    const me = this.user(App.user.id);
    if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must be 4–6 digits');
    if (this.DEMO_PINS.includes(pin) || /^(\d)\1+$/.test(pin)) throw new Error('That PIN is too easy to guess. Choose another.');
    if (this.data.users.some(u => u.id !== me.id && u.pin === pin)) throw new Error('That PIN is already used by someone else');
    me.pin = pin;
    this.save();
  },
};
