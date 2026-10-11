'use strict';

// Light / dark appearance. Loaded in <head> so the right colours are on the page before anything is drawn.
// Until someone presses the switch the device decides (its own light/dark setting); after that their choice is kept on this device.
// The page only ever carries data-theme="light" or "dark" (css/base.css holds the dark colours).
const Theme = {
  KEY: 'pos-theme',
  media: typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null,

  saved() {
    try {
      const v = localStorage.getItem(this.KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) { return null; }   // private mode: just follow the device
  },

  current() { return this.saved() || (this.media && this.media.matches ? 'dark' : 'light'); },

  apply() {
    const mode = this.current();
    document.documentElement.setAttribute('data-theme', mode);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#0c0a08' : '#1f1b16');
    document.querySelectorAll('.theme-btn').forEach(b => { b.innerHTML = this.glyph(); b.title = this.title(); });
  },

  glyph() { return icon(this.current() === 'dark' ? 'sun' : 'moon'); },
  title() { return this.current() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'; },

  toggle() {
    try { localStorage.setItem(this.KEY, this.current() === 'dark' ? 'light' : 'dark'); } catch (e) { /* not kept */ }
    this.apply();
  },

  // The switch shown on the sign-in screen, the top bar and the guest menu.
  button() {
    return `<button class="btn small theme-btn" data-act="theme" data-nav="theme" data-no-i18n aria-label="Light / dark mode" title="${this.title()}">${this.glyph()}</button>`;
  },
};

Theme.apply();
// Follow the device when its setting changes and the person has not chosen.
if (Theme.media) {
  const follow = () => { if (!Theme.saved()) Theme.apply(); };
  if (Theme.media.addEventListener) Theme.media.addEventListener('change', follow);
  else if (Theme.media.addListener) Theme.media.addListener(follow);
}
