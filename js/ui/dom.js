'use strict';

// Small browser helpers: finding elements, escaping text, reading forms, notices, a beep and downloading a file.

const $ = (sel, root = document) => root.querySelector(sel);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formValues(el) {
  const out = {};
  el.querySelectorAll('[name]').forEach(f => { out[f.name] = f.type === 'checkbox' ? f.checked : f.value.trim(); });
  return out;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

let audioCtx = null;

function beep(times = 1) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const t = audioCtx.currentTime + i * 0.25;
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch (e) { /* sound is optional */ }
}

// A CSV gets a byte-order mark so Excel opens it as UTF-8 (otherwise Myanmar names turn into garbage).
function downloadFile(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([type === 'text/csv' ? '\ufeff' + content : content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
