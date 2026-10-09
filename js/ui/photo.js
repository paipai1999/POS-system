'use strict';

// Menu pictures. A phone photo is several megabytes, so it is shrunk in the browser to a small JPEG before it is kept.
// With the POS server the picture is uploaded and the item stores only its file name; in single-device mode the small
// picture itself is stored inside the item (as a data: URL).
const Photo = {
  NAME: /^[a-f0-9]{24}\.(jpg|png|webp)$/,

  // The address to show for an item, or '' when it has no (usable) picture.
  src(p) {
    const v = p && p.photo;
    if (typeof v !== 'string' || !v) return '';
    if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v)) return v;
    return this.NAME.test(v) ? '/photos/' + v : '';
  },

  // The picture as an <img>, or '' when the item has none. If it cannot be loaded the listener below swaps in the
  // item's icon, using `fallback` as its class.
  img(p, cls, fallback = cls) {
    const src = this.src(p);
    return src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" decoding="async" data-emoji="${esc(p.emoji || '🍽️')}" data-fallback="${esc(fallback)}">` : '';
  },

  // Shrinks a chosen file to a JPEG that fits in `max` pixels on its longer side. Rejects with a message fit for a toast.
  async prepare(file, { max = 640, quality = 0.82 } = {}) {
    if (!file || !/^image\/(jpeg|png|webp|heic|heif|gif|bmp)$/.test(file.type || '')) throw new Error('Choose a picture (JPEG, PNG or WebP)');
    if (file.size > 30 * 1024 * 1024) throw new Error('That picture is too large');
    let bitmap;
    try {
      bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(file) : await this.load(file);
    } catch (e) {
      throw new Error('This browser could not open that picture');
    }
    const w = bitmap.width, h = bitmap.height;
    if (!w || !h) throw new Error('This browser could not open that picture');
    const scale = Math.min(1, max / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';                       // a PNG with a see-through background would turn black as a JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('This browser could not shrink that picture');
    return { blob, width: canvas.width, height: canvas.height };
  },

  load(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
  },

  dataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('This browser could not read that picture'));
      r.readAsDataURL(blob);
    });
  },

  // Chooses how a prepared picture is kept: uploaded (server) or inside the item (single-device mode, so it is made smaller).
  async store(file) {
    if (Store.server) return Sync.uploadPhoto((await this.prepare(file)).blob);
    return this.dataURL((await this.prepare(file, { max: 300, quality: 0.7 })).blob);
  },
};

// A picture that fails to load (file lost, device offline) is replaced by the item's icon so the tile never shows a broken image.
document.addEventListener('error', e => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || !img.dataset.fallback) return;
  const span = document.createElement('span');
  span.className = img.dataset.fallback + ' photo-missing';
  span.textContent = img.dataset.emoji || '🍽️';
  img.replaceWith(span);
}, true);
