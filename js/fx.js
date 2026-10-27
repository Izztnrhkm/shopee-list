// Feel: short sounds, haptics and small animations. Sounds are made with the Web Audio API
// (no files to download). On iPhone, Web Audio stays quiet when the silent switch is on.
// Everything respects the phone's Reduce Motion setting and the Sounds switch in Household.

const SOUND_KEY = 'shopee-list-sound';
let ctx = null;

export function soundOn() {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

export function setSound(on) {
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  if (on) play('success');
}

export function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// One soft note: frequency in Hz, start offset and length in seconds.
function note(ac, freq, at, len, { type = 'sine', gain = 0.08 } = {}) {
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(amp).connect(ac.destination);
  osc.start(t);
  osc.stop(t + len + 0.02);
}

const SOUNDS = {
  tap: (ac) => note(ac, 880, 0, 0.05, { type: 'triangle', gain: 0.035 }),
  toggle: (ac) => note(ac, 660, 0, 0.07, { type: 'triangle', gain: 0.05 }),
  bought: (ac) => { note(ac, 784, 0, 0.12, { type: 'triangle' }); note(ac, 1175, 0.07, 0.2, { type: 'triangle' }); },
  unbought: (ac) => note(ac, 392, 0, 0.12, { type: 'triangle', gain: 0.05 }),
  success: (ac) => { [523, 659, 784, 1047].forEach((f, i) => note(ac, f, i * 0.07, 0.22, { type: 'triangle', gain: 0.06 })); },
  error: (ac) => { note(ac, 330, 0, 0.14, { type: 'square', gain: 0.03 }); note(ac, 247, 0.12, 0.2, { type: 'square', gain: 0.03 }); },
};

const BUZZ = { tap: 5, toggle: 8, bought: [12, 40, 18], unbought: 8, success: [10, 30, 10, 30, 20], error: [30, 40, 30] };

export function play(name) {
  // Browsers only allow sound and vibration after the first tap; before that (for example an
  // error shown while the page loads) stay silent instead of logging a blocked-call error.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  if (navigator.vibrate && BUZZ[name]) {
    try { navigator.vibrate(BUZZ[name]); } catch { /* not allowed before a tap */ }
  }
  if (!soundOn()) return;
  const ac = audio();
  if (ac && SOUNDS[name]) SOUNDS[name](ac);
}

// A small burst of confetti from an element (used when something is bought).
export function confetti(fromEl) {
  if (reducedMotion() || !fromEl) return;
  const r = fromEl.getBoundingClientRect();
  const colors = ['#e8572a', '#f2b33d', '#1d5e6b', '#1a7a43', '#c4461b'];
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('i');
    const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
    const dist = 40 + Math.random() * 36;
    p.style.left = `${r.left + r.width / 2}px`;
    p.style.top = `${r.top + r.height / 2}px`;
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist - 20}px`);
    p.style.setProperty('--rot', `${Math.round(Math.random() * 360)}deg`);
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 900);
}

// Counts a money figure up from zero when a screen opens.
export function countUp(el, value, format) {
  if (!el || reducedMotion() || !(value > 0)) return;
  const start = performance.now();
  const dur = 450;
  const step = (now) => {
    const k = Math.min(1, (now - start) / dur);
    el.textContent = format(value * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = format(0);
  requestAnimationFrame(step);
}

// A light tap sound for buttons, tabs and filters anywhere in the app. Elements can opt out
// with data-sound="none" or pick another sound with data-sound="toggle".
export function installTapSounds(root = document) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('button, a.btn, .tabbar a, .segmented a, .check-row, .avatars');
    if (!el || el.disabled) return;
    const s = el.dataset.sound;
    if (s === 'none') return;
    play(s || 'tap');
  }, true);
}
