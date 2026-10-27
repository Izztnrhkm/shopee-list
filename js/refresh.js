// Getting the newest version of the app without closing it (the home-screen app has no
// browser reload button):
// - the circular-arrow button in the header,
// - pulling the page down from the top (touch screens),
// - a "New version ready" pill that appears by itself after a deploy. Each deploy writes
//   version.json (see .github/workflows/firebase-hosting.yml); the app compares it with the
//   one it started with whenever it comes back to the front, and every 5 minutes.
// Lists and items are live already; refreshing is for new app code and new research.

const PULL_READY = 70; // px of finger travel that triggers a refresh
const PULL_MAX = 110;

let reloading = false;

export function reloadApp(before) {
  if (reloading) return;
  reloading = true;
  document.documentElement.classList.add('reloading');
  if (before) before();
  // A short beat so the spinner and sound register before the page goes away.
  setTimeout(() => location.reload(), 280);
}

// ---------- pull down to refresh ----------

function busyTarget(el) {
  return !!(el && el.closest && el.closest('dialog, input, textarea, select, [contenteditable="true"]'));
}

export function installPullToRefresh({ indicator, onReady, onRefresh }) {
  let startY = null;
  let startX = 0;
  let dist = 0;
  let ready = false;

  const set = (d) => {
    dist = d;
    const p = Math.min(1, d / PULL_READY);
    indicator.style.transform = `translate(-50%, ${Math.round(Math.min(d, PULL_MAX) * 0.6) - 48}px)`;
    indicator.style.opacity = String(Math.min(1, p * 1.4));
    indicator.style.setProperty('--turn', `${Math.round(p * 270)}deg`);
    const nowReady = d >= PULL_READY;
    if (nowReady !== ready) {
      ready = nowReady;
      indicator.classList.toggle('ready', ready);
      if (ready && onReady) onReady();
    }
  };
  const reset = () => {
    startY = null;
    indicator.classList.remove('pulling', 'ready');
    indicator.style.transform = '';
    indicator.style.opacity = '';
    ready = false;
    dist = 0;
  };

  window.addEventListener('touchstart', (e) => {
    if (reloading || e.touches.length !== 1 || window.scrollY > 0 || busyTarget(e.target) || document.querySelector('dialog[open]')) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    const dx = Math.abs(e.touches[0].clientX - startX);
    if (window.scrollY > 0 || (dist === 0 && dx > dy)) { reset(); return; }
    if (dy <= 0) { if (dist) set(0); return; }
    if (!indicator.classList.contains('pulling')) indicator.classList.add('pulling');
    set(dy * 0.85);
  }, { passive: true });

  const end = () => {
    if (startY === null) return;
    if (ready) {
      indicator.classList.remove('pulling');
      indicator.classList.add('refreshing');
      indicator.style.transform = 'translate(-50%, 16px)';
      startY = null;
      onRefresh();
    } else {
      reset();
    }
  };
  window.addEventListener('touchend', end, { passive: true });
  window.addEventListener('touchcancel', reset, { passive: true });
}

// ---------- new version notice ----------

async function fetchVersion() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const v = await res.json();
    return v && v.version ? String(v.version) : null;
  } catch {
    return null;
  }
}

export async function watchForUpdates(onUpdate) {
  const mine = await fetchVersion();
  if (!mine) return; // local copy or not deployed by the workflow: nothing to compare
  let told = false;
  const check = async () => {
    if (told || document.visibilityState !== 'visible') return;
    const latest = await fetchVersion();
    if (latest && latest !== mine) { told = true; onUpdate(latest); }
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  setInterval(check, 5 * 60 * 1000);
}
