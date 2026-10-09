'use strict';

// Settings: the restaurant's tables.
Object.assign(Screens.settings, {
  addTable() {
    const input = this.root.querySelector('[data-role=new-table]');
    const name = input.value.trim();
    if (!name) return toast('Enter a table name', 'error');
    Store.data.tables.push({ id: uid('t_'), name, guestCode: guestCode() });
    Store.save();
    this.render(this.root);
  },

  renameTable(id) {
    const t = Store.table(id);
    const actions = {
      save: () => {
        const name = Modal.el().querySelector('[name=name]').value.trim();
        if (!name) return toast('Name is required', 'error');
        const cur = Store.table(id);
        if (cur) cur.name = name;
        Store.save();
        Modal.close();
        this.render(this.root);
      },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: 'Rename table',
      body: `<label class="field"><span>Name</span><input class="input" name="name" value="${esc(t.name)}" autofocus></label>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>',
      actions,
    });
  },

  deleteTable(id) {
    const t = Store.table(id);
    if (Store.openOrderForTable(id)) return toast(`${t.name} has an open order`, 'error');
    confirmDialog({
      title: `Delete ${t.name}?`,
      message: Store.server ? 'Its QR code will stop working.' : '',
      okLabel: 'Delete',
      danger: true,
      onOk: () => {
        Store.data.tables = Store.data.tables.filter(x => x.id !== id);
        Store.save();
        this.render(this.root);
      },
    });
  },

  tablesHTML(server) {
    return `
      <section class="card">
                <h2>Tables</h2>
                <div class="list">
                  ${Store.data.tables.map(t => `
                    <div class="list-row">
                      <span>🪑 ${esc(t.name)}</span>
                      <div class="row-actions">
                        <button class="btn small" data-act="rename-table" data-id="${t.id}">Rename</button>
                        <button class="btn small danger" data-act="del-table" data-id="${t.id}">Delete</button>
                      </div>
                    </div>`).join('') || '<p class="empty small">No tables yet.</p>'}
                </div>
                <div class="inline-add">
                  <input class="input" data-role="new-table" placeholder="e.g. Table 11 or Patio 1">
                  <button class="btn" data-act="add-table">Add table</button>
                </div>
                <div class="spaced">
                  <button class="btn" data-act="qr" ${server && Store.data.tables.length ? '' : 'disabled'}>🔳 Print table QR codes</button>
                  ${server ? '' : '<p class="muted small">QR ordering needs the POS server (see README).</p>'}
                </div>
              </section>`;
  }
});
