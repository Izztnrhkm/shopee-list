// Light or dark look, chosen per phone: Auto (follow the phone), Light or Dark.
// The choice is applied as <html data-theme="light|dark">; an inline script in index.html sets it
// before the first paint so the page never flashes the wrong colours.
// Switching animates as a circle that grows from the button you tapped (View Transitions),
// with a colour fade on browsers without them, and no animation with Reduce Motion.

const KEY = 'shopee-list-theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export const THEMES = { auto: 'Auto', light: 'Light', dark: 'Dark' };

export function themeChoice() {
  let v = null;
  try { v = localStorage.getItem(KEY); } catch { /* private mode */ }
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export function currentTheme(choice = themeChoice()) {
  if (choice === 'auto') return darkQuery.matches ? 'dark' : 'light';
  return choice;
}

function apply() {
  document.documentElement.setAttribute('data-theme', currentTheme());
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Where the circle starts: the centre of the tapped control, else the top right corner.
function origin(el) {
  if (el && el.getBoundingClientRect) {
    const r = el.getBoundingClientRect();
    if (r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth - 40, y: 30 };
}

let busy = false;

// choice: 'auto' | 'light' | 'dark'. fromEl: the tapped control. after: re-render the page
// (runs inside the transition, so the new picture already shows the updated controls).
export function setTheme(choice, fromEl, after) {
  const before = currentTheme();
  try {
    if (choice === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch { /* still switch for this visit */ }
  const update = () => { apply(); if (after) after(); };
  const changes = currentTheme(choice) !== before;

  if (!changes || busy || reducedMotion()) { update(); return; }

  if (typeof document.startViewTransition !== 'function') {
    const root = document.documentElement;
    root.classList.add('theme-fading');
    update();
    setTimeout(() => root.classList.remove('theme-fading'), 450);
    return;
  }

  busy = true;
  const { x, y } = origin(fromEl);
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const transition = document.startViewTransition(update);
  transition.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 520, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  }).catch(() => {});
  transition.finished.finally(() => { busy = false; });
}

export function initTheme() {
  apply();
  // In Auto, follow the phone when it switches between light and dark (for example at sunset).
  const follow = () => { if (themeChoice() === 'auto') apply(); };
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', follow);
  else if (darkQuery.addListener) darkQuery.addListener(follow);
}
