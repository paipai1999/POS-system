'use strict';

// Item editor, photo part. The picture is chosen, shrunk and uploaded as soon as it is picked, so Save stays instant.
// Every editor part (photo, options, recipe) is made by a method like this one and has the same shape:
//   { html(), actions: { name: handler }, input(e), change(e), afterOpen(), read() }
// read() returns the fields this part contributes to the item, or throws an Error with a message for the person.
Object.assign(Screens.products, {
  photoSection(p) {
    let photo = p.photo || '';
    let busy = false;

    const preview = () => {
      const m = Modal.el();
      const emoji = (m.querySelector('[name=emoji]') || {}).value || p.emoji || '🍽️';
      m.querySelector('[data-role=photo-preview]').innerHTML = busy ? '<span class="muted small">Uploading photo…</span>' : Photo.img({ photo, emoji }, 'photo-big') || esc(emoji);
      m.querySelector('[data-act=photo-clear]').hidden = !photo;
    };

    const choose = async file => {
      const modal = Modal.el();
      busy = true;
      preview();
      try { photo = await Photo.store(file); } catch (e) { toast(e.message, 'error'); }
      busy = false;
      if (modal.isConnected && Modal.el() === modal) preview();   // the dialog may have been closed meanwhile
    };

    return {
      html: () => `
        <div class="photo-field">
          <div class="photo-preview" data-role="photo-preview"></div>
          <div class="photo-actions">
            <div class="btn-row">
              <button class="btn small" data-act="photo-pick">📷 Choose photo</button>
              <button class="btn small" data-act="photo-clear" ${photo ? '' : 'hidden'}>Remove photo</button>
            </div>
            <input type="file" accept="image/*" data-role="photo-file" hidden>
            <span class="muted small">Shown on the order screen and the guest menu. The picture is shrunk automatically.</span>
          </div>
        </div>`,
      actions: {
        'photo-pick': () => Modal.el().querySelector('[data-role=photo-file]').click(),
        'photo-clear': () => { photo = ''; preview(); },
      },
      input(e) { if (e.target.name === 'emoji' && !photo) preview(); },   // the icon is what shows while there is no picture
      change(e) {
        if (e.target.dataset.role !== 'photo-file') return;
        const file = e.target.files && e.target.files[0];
        e.target.value = '';                    // choosing the same file again must still fire
        if (file) choose(file);
      },
      afterOpen: preview,
      read() {
        if (busy) throw new Error('Wait for the photo to finish uploading');
        return { photo };
      },
    };
  },
});
