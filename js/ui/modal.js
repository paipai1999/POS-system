'use strict';

// Dialogs: the modal window itself, confirmations, asking for a staff PIN and choosing a new PIN.

// One modal at a time. Buttons use data-act="name", handled by actions[name].
// Special handlers: __input, __change (form events), __enter (Enter key).
const Modal = {
  handlers: {},
  onClose: null,

  init() {
    const root = $('#modal-root');
    let downOnBackdrop = false;
    root.addEventListener('mousedown', e => { downOnBackdrop = e.target.classList.contains('modal-backdrop'); });
    root.addEventListener('click', e => {
      if (e.target.classList.contains('modal-backdrop')) {
        if (downOnBackdrop) this.close();
        return;
      }
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      if (t.dataset.act === '__close') return this.close();
      const fn = this.handlers[t.dataset.act];
      if (fn) fn(t, e);
    });
    root.addEventListener('input', e => this.handlers.__input && this.handlers.__input(e));
    root.addEventListener('change', e => this.handlers.__change && this.handlers.__change(e));
  },

  // Opening a modal replaces the current one without running its onClose.
  // A `locked` modal cannot be dismissed (Esc, backdrop, ✕) – only by its own actions calling close(true).
  open({ title, body, footer = '', wide = false, actions = {}, onClose = null, locked = false }) {
    const root = $('#modal-root');
    this.locked = locked;
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <header class="modal-head"><h2>${esc(title)}</h2>${locked ? '' : '<button class="icon-btn" data-act="__close" aria-label="Close">✕</button>'}</header>
          <div class="modal-body">${body}</div>
          ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
        </div>
      </div>`;
    this.handlers = actions;
    this.onClose = onClose;
    root.hidden = false;
    const focus = root.querySelector('[autofocus]');
    if (focus) focus.focus();
    return this.el();
  },

  close(force = false) {
    const root = $('#modal-root');
    if (root.hidden || (this.locked && !force)) return;
    this.locked = false;
    const cb = this.onClose;
    this.onClose = null;
    this.handlers = {};
    root.innerHTML = '';
    root.hidden = true;
    if (cb) cb();
  },

  get isOpen() { return !$('#modal-root').hidden; },
  el() { return $('#modal-root .modal'); },

  onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if (e.key === 'Enter' && this.handlers.__enter && !e.target.matches('textarea, button')) {
      e.preventDefault();
      this.handlers.__enter();
    }
  },
};

function confirmDialog({ title, message = '', okLabel = 'Confirm', danger = false, onOk }) {
  Modal.open({
    title,
    body: `<p>${esc(message)}</p>`,
    footer: `<button class="btn" data-act="__close">Cancel</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-act="ok">${esc(okLabel)}</button>`,
    actions: { ok: () => { Modal.close(); onOk(); } },
  });
}

// Asks for any staff PIN; `allow(user)` can restrict who may approve.
function pinPrompt({ title = 'Staff PIN', message = '', allow = () => true, onOk, onCancel }) {
  let done = false;
  let busy = false;
  const actions = {
    ok: async () => {
      const modal = Modal.el();
      const input = modal && modal.querySelector('.pin-input');
      if (!input || busy) return;
      busy = true;
      let user;
      try {
        user = await Store.verifyPin(input.value);
      } catch (e) {
        busy = false;
        toast(e.message || 'Wrong PIN', 'error');
        input.value = '';
        input.focus();
        return;
      }
      busy = false;
      if (Modal.el() !== modal) return; // closed while the server was checking
      if (!allow(user)) { toast(`${user.name} is not allowed to approve this`, 'error'); input.value = ''; return; }
      done = true;
      Modal.close();
      onOk(user);
    },
  };
  actions.__enter = actions.ok;
  Modal.open({
    title,
    body: `${message ? `<p class="muted">${esc(message)}</p>` : ''}
      <input class="input pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="PIN" autofocus>`,
    footer: `<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="ok">Confirm</button>`,
    actions,
    onClose: () => { if (!done && onCancel) onCancel(); },
  });
}

// A staff member still using a demo PIN must choose their own before doing anything else.
function forcePinChange(onDone) {
  let busy = false;
  const actions = {
    save: async () => {
      if (busy) return;
      const m = Modal.el();
      const pin = m.querySelector('[name=pin]').value.trim();
      const again = m.querySelector('[name=again]').value.trim();
      if (!/^\d{4,6}$/.test(pin)) return toast('PIN must be 4–6 digits', 'error');
      if (pin !== again) return toast('The two PINs do not match', 'error');
      busy = true;
      try {
        await Store.changeOwnPin(pin);
        Modal.close(true);
        toast('PIN changed', 'ok');
        if (onDone) onDone();
      } catch (e) {
        toast(e.message, 'error');
      }
      busy = false;
    },
    logout: () => { Modal.close(true); App.logout(); },
  };
  actions.__enter = actions.save;
  Modal.open({
    title: 'Choose your own PIN',
    locked: true,
    body: `
      <p class="muted">You are signed in with a PIN that came with the demo data, which anyone could guess. Choose a new 4–6 digit PIN that only you know.</p>
      <label class="field"><span>New PIN</span><input class="input pin-input" name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" autofocus></label>
      <label class="field"><span>Repeat new PIN</span><input class="input pin-input" name="again" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label>`,
    footer: '<button class="btn" data-act="logout">Sign out</button><button class="btn primary" data-act="save">Save PIN</button>',
    actions,
  });
}

function requireManager(reason, onOk, onCancel) {
  if (App.can('manage')) return onOk(App.user);
  pinPrompt({ title: 'Manager approval', message: reason, allow: u => App.can('manage', u), onOk, onCancel });
}
