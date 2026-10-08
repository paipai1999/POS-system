'use strict';

Screens.login = {
  fullscreen: true,
  live: [],
  state: { userId: null, pin: '', error: false },

  render(root) {
    const st = this.state;
    const users = Store.data.users.filter(u => u.active);
    const dots = Math.max(4, st.pin.length);
    const demo = Store.server ? !!Store.data.demo : Store.data.users.some(u => u.role === 'admin' && u.pin === '1234');
    root.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="login-brand">🍽️</div>
          <h1>${esc(Store.settings.name)}</h1>
          <p class="muted">${st.userId ? 'Enter your PIN' : 'Tap your name to sign in'}</p>
          <div class="user-grid">
            ${users.map(u => `
              <button class="user-tile ${u.id === st.userId ? 'selected' : ''}" data-act="pick" data-id="${u.id}">
                <span class="avatar">${esc(initials(u.name))}</span>
                <span>${esc(u.name)}</span>
                <small>${ROLES[u.role].label}</small>
              </button>`).join('')}
          </div>
          <div class="pin-dots ${st.error ? 'shake' : ''}">
            ${Array.from({ length: dots }, (_, i) => `<i class="${i < st.pin.length ? 'on' : ''}"></i>`).join('')}
          </div>
          <div class="keypad ${st.userId ? '' : 'disabled'}">
            ${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'].map(k => `
              <button data-act="key" data-key="${k}" class="${k === 'ok' ? 'go' : ''}" aria-label="${k}">${k === 'back' ? '⌫' : k === 'ok' ? '✓' : k}</button>`).join('')}
          </div>
          ${demo ? '<p class="login-hint">Demo PINs: Admin 1234 · Maya (cashier) 1111 · Leo (waiter) 2222 · Kitchen 3333.<br>Change them under Staff.</p>' : ''}
        </div>
        ${Store.server ? '' : '<button class="guest-link" data-act="guest">📖 Open guest menu</button>'}
      </div>`;
    st.error = false;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'pick') { st.userId = t.dataset.id; st.pin = ''; this.render(root); }
      else if (t.dataset.act === 'key') this.press(root, t.dataset.key);
      else if (t.dataset.act === 'guest') { st.userId = null; st.pin = ''; App.go('guest'); }
    };
    App.keyHandler = e => {
      if (/^\d$/.test(e.key)) this.press(root, e.key);
      else if (e.key === 'Backspace') this.press(root, 'back');
      else if (e.key === 'Enter') this.press(root, 'ok');
    };
  },

  press(root, key) {
    const st = this.state;
    if (!st.userId) return;
    if (key === 'ok') return this.submit(root);
    if (key === 'back') st.pin = st.pin.slice(0, -1);
    else if (st.pin.length < 6) st.pin += key;
    this.render(root);
  },

  async submit(root) {
    const st = this.state;
    if (this.busy) return;
    this.busy = true;
    try {
      const user = await Store.login(st.userId, st.pin);
      st.userId = null;
      st.pin = '';
      App.user = user;
      App.go(App.firstScreen());
    } catch (e) {
      st.pin = '';
      st.error = true;
      if (e.message !== 'Incorrect PIN') toast(e.message, 'error');
      if (App.screen === 'login') this.render(root);
    } finally {
      this.busy = false;
    }
  },
};
