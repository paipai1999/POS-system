'use strict';

Screens.users = {
  perm: 'users',
  live: ['users'],
  root: null,

  render(root) {
    this.root = root;
    const users = Store.data.users;
    root.innerHTML = `
      <div class="page-head">
        <h1>Staff</h1>
        <div class="actions"><button class="btn primary" data-act="new">＋ Add staff</button></div>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Name</th><th>Role</th><th>Access</th><th>Status</th><th></th></tr></thead>
          <tbody>${users.map(u => `
            <tr>
              <td><span class="avatar sm">${esc(initials(u.name))}</span> <b>${esc(u.name)}</b>${u.id === App.user.id ? ' <span class="muted small">(you)</span>' : ''}</td>
              <td>${ROLES[u.role].label}</td>
              <td class="muted small wrap-cell">${ROLE_INFO[u.role]}</td>
              <td><span class="pill ${u.active ? 'paid' : 'muted'}">${u.active ? 'Active' : 'Inactive'}</span></td>
              <td><div class="row-actions"><button class="btn small" data-act="edit" data-id="${u.id}">Edit</button></div></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="muted small spaced">Each staff member signs in with their own PIN. PINs must be unique because they are also used for manager approvals.</p>`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'new') this.edit(null);
      else if (t.dataset.act === 'edit') this.edit(t.dataset.id);
    };
  },

  // At least one active admin must always remain, otherwise nobody could reach Staff or Settings.
  leavesAdmin(id, role, active) {
    return Store.data.users.some(u => u.id !== id && u.role === 'admin' && u.active) || (role === 'admin' && active);
  },

  edit(id) {
    const u = id ? Store.user(id) : { name: '', role: 'waiter', pin: '', active: true };
    const actions = {
      save: () => {
        const v = formValues(Modal.el());
        if (!v.name) return toast('Name is required', 'error');
        if (!id && !v.pin) return toast('Set a PIN', 'error');
        if (v.pin && !/^\d{4,6}$/.test(v.pin)) return toast('PIN must be 4–6 digits', 'error');
        if (v.pin && Store.data.users.some(x => x.id !== id && x.pin === v.pin)) return toast('That PIN is already used by someone else', 'error');
        if (!this.leavesAdmin(id, v.role, v.active)) return toast('At least one active admin is required', 'error');
        if (id === App.user.id && !v.active) return toast('You cannot deactivate yourself', 'error');
        const data = { name: v.name, role: v.role, active: v.active };
        if (v.pin) data.pin = v.pin;
        if (id) Object.assign(Store.user(id) || u, data);
        else Store.data.users.push({ id: uid('u_'), ...data });
        Store.save();
        Modal.close();
        if (id === App.user.id && !App.can('users')) return App.go(App.firstScreen());
        App.render();
        toast('Saved', 'ok');
      },
      delete: () => {
        if (id === App.user.id) return toast('You cannot delete yourself', 'error');
        if (!this.leavesAdmin(id, null, false)) return toast('At least one active admin is required', 'error');
        // In server mode the server also checks older orders that are not on this device.
        if (Store.data.orders.some(o => o.staffId === id || o.cashierId === id)) {
          return toast(`${u.name} has order history. Deactivate instead so reports stay accurate.`, 'error');
        }
        confirmDialog({
          title: `Delete ${u.name}?`,
          okLabel: 'Delete',
          danger: true,
          onOk: () => {
            Store.data.users = Store.data.users.filter(x => x.id !== id);
            Store.save();
            App.render();
          },
        });
      },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: id ? `Edit ${u.name}` : 'New staff member',
      body: `
        <label class="field"><span>Name</span><input class="input" name="name" value="${esc(u.name)}" autofocus></label>
        <label class="field"><span>Role</span>
          <select class="input" name="role">
            ${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${r.label} — ${ROLE_INFO[k]}</option>`).join('')}
          </select></label>
        <label class="field"><span>${id ? 'New PIN (leave blank to keep current)' : 'PIN (4–6 digits)'}</span>
          <input class="input" name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label>
        <label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active (can sign in)</label>`,
      footer: `${id ? '<button class="btn danger" data-act="delete">Delete</button><span class="spacer"></span>' : ''}
        <button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>`,
      actions,
    });
  },
};
