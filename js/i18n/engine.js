'use strict';

// Myanmar (မြန်မာ) interface. The screens are written in English; this layer swaps the words shown on screen
// for Myanmar ones using the word lists in js/i18n/my/ (one file per screen). Anything it does not know stays in English, so a new
// feature never shows blank text. Menu item, staff and table names are left as typed (unless a name is itself one
// of the interface words, such as a user called "Admin"), and printed
// receipts / kitchen tickets stay as they are (thermal printers often cannot print Myanmar script).
const I18N = {
  lang: 'en',
  dict: {},       // exact English text -> Myanmar
  patterns: [],   // [RegExp, template with $1, $2 …] for text that contains numbers or names
  missing: new Set(),
  original: new WeakMap(),  // text node / element attribute -> the English it came from
  done: new WeakMap(),      // text node -> the Myanmar text we put there (so our own edit is not translated again)
  observer: null,
  ATTRS: ['placeholder', 'title', 'aria-label'],
  // Text inside these is left alone. Fields themselves are skipped for their typed text, but not for their placeholder.
  SKIP: 'script, style, code, pre, textarea, input, .receipt, #print-area, [data-no-i18n]',
  SKIP_ATTRS: 'script, style, code, pre, .receipt, #print-area, [data-no-i18n]',

  init() {
    let saved = 'en';
    try { saved = localStorage.getItem('pos-lang') || 'en'; } catch (e) { /* private mode */ }
    this.apply(saved === 'my' ? 'my' : 'en');
  },

  set(lang) {
    try { localStorage.setItem('pos-lang', lang); } catch (e) { /* ignore */ }
    this.apply(lang);
  },

  apply(lang) {
    this.lang = lang;
    document.documentElement.lang = lang === 'my' ? 'my' : 'en';
    if (lang === 'my') {
      this.walk(document.body);
      if (!this.observer) {
        this.observer = new MutationObserver(list => this.onMutations(list));
        this.observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: this.ATTRS });
      }
    } else {
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      this.restore(document.body);
    }
  },

  // The switch shown on the sign-in screen, the top bar and the guest menu. Its label is never translated.
  button(act = 'lang') {
    return `<button class="btn small lang-btn" data-act="${act}" data-nav="${act}" data-no-i18n title="Language / ဘာသာစကား">🌐 ${this.lang === 'my' ? 'English' : 'မြန်မာ'}</button>`;
  },

  toggle() { this.set(this.lang === 'my' ? 'en' : 'my'); },

  // The menu bar has ten buttons; Myanmar words are long, so it uses a short word for each (see navShort in i18n-my.js).
  navShort: {},
  navLabel(item) {
    return this.lang === 'my' && this.navShort[item.id] ? this.navShort[item.id] : item.label;
  },

  // Translate one piece of text; returns null when there is nothing to change.
  tr(text) {
    const norm = String(text).replace(/\s+/g, ' ').trim();
    if (norm.length < 2 || !/[A-Za-z]/.test(norm) || /^https?:/i.test(norm)) return null;
    const lead = text.match(/^\s*/)[0], tail = text.match(/\s*$/)[0];
    const found = this.lookup(norm);
    if (found == null) { this.missing.add(norm); return null; }
    return lead + found + tail;
  },

  lookup(norm) {
    if (this.dict[norm] != null) return this.dict[norm];
    // Leading icons / symbols and trailing "…", ":" or "?" are kept, the words in between are translated.
    const m = norm.match(/^([^\p{L}\p{N}]*)(.*?)([\s…:.!?]*)$/u);
    const parts = m && m[2] ? [m[1], m[2], m[3]] : ['', norm, ''];
    const core = parts[1];
    let out = this.dict[core];
    if (out == null) {
      for (const [re, tpl] of this.patterns) {
        const hit = core.match(re);
        if (hit) { out = tpl.replace(/\$(\d)/g, (_, i) => this.part(hit[+i])); break; }
      }
    }
    // A full stop at the end of an English sentence becomes the Myanmar one.
    return out == null ? null : parts[0] + out + parts[2].replace(/\./g, '။');
  },

  // Words captured inside a pattern are translated too (e.g. "paid" in "Order #4 was paid on another device").
  part(s) {
    if (s == null) return '';
    const t = this.lookup(s);
    return t != null ? t : s;
  },

  skipped(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !el || !!el.closest(this.SKIP);
  },

  translateNode(node) {
    if (node.nodeType === 3) {
      if (this.done.get(node) === node.nodeValue || this.skipped(node)) return;
      const out = this.tr(node.nodeValue);
      if (out == null) return;
      this.original.set(node, node.nodeValue);
      this.done.set(node, out);
      node.nodeValue = out;
    } else if (node.nodeType === 1 && !node.closest(this.SKIP_ATTRS)) {
      for (const a of this.ATTRS) this.translateAttr(node, a);
    }
  },

  translateAttr(el, name) {
    if (!el.hasAttribute(name)) return;
    const val = el.getAttribute(name);
    const key = el;
    const store = this.original.get(key) || {};
    if (store[name] && this.done.get(key) && this.done.get(key)[name] === val) return;
    const out = this.tr(val);
    if (out == null) return;
    store[name] = val;
    this.original.set(key, store);
    const d = this.done.get(key) || {};
    d[name] = out;
    this.done.set(key, d);
    el.setAttribute(name, out);
  },

  walk(root) {
    if (!root) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n = w.currentNode;
    while (n) { this.translateNode(n); n = w.nextNode(); }
  },

  onMutations(list) {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(n => this.walk(n.nodeType === 1 || n.nodeType === 3 ? n : null));
      else if (m.type === 'characterData') this.translateNode(m.target);
      else if (m.type === 'attributes') this.translateAttr(m.target, m.attributeName);
    }
  },

  restore(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n = w.currentNode;
    while (n) {
      if (n.nodeType === 3 && this.original.has(n) && this.done.get(n) === n.nodeValue) n.nodeValue = this.original.get(n);
      else if (n.nodeType === 1 && this.original.has(n)) {
        const orig = this.original.get(n), done = this.done.get(n) || {};
        for (const a of Object.keys(orig)) if (n.getAttribute(a) === done[a]) n.setAttribute(a, orig[a]);
      }
      n = w.nextNode();
    }
  },
};
