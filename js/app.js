import * as store from './store.js';
import {
  h,
  formatRM,
  formatCount,
  parseMoney,
  parseCount,
  parseRating,
  cleanUrl,
  isShopeeMY,
  listingTotal,
  pickListing,
  productEstimate,
  newId,
  todayISO,
  priorityOf,
  firstSentence,
  nextSale,
  ageText,
} from './util.js';
import { parseImport, planImport, historyOf, VERDICTS, TAGS, PRIORITIES } from './importer.js';

const BADGES = {
  none: 'Regular seller',
  preferred: 'Preferred',
  preferredPlus: 'Preferred+',
  mall: 'Shopee Mall',
};

const state = {
  user: undefined, // undefined = still checking, null = signed out
  lists: [],
  products: [],
  loaded: false,
  filter: 'buy',
  stopWatching: null,
  dataError: null,
  household: null,
  members: [],
  needsHousehold: false, // signed in with no household yet, holding an invite link
  library: null, // research library index, loaded on the Add page
  libraryError: null,
  picked: new Set(),
};

const main = document.getElementById('main');
const headerUser = document.getElementById('header-user');
const tabbar = document.getElementById('tabbar');
const toastEl = document.getElementById('toast');

// ---------- icons (fixed strings, never user text) ----------

const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/></svg>',
  lists: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.4.2 4 1.8 4.5 4.5"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/></svg>',
};

function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = ICONS[name];
  return t.content.firstChild;
}

// ---------- feedback ----------

let toastTimer;
function toast(message, kind = 'info') {
  toastEl.textContent = message;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, kind === 'error' ? 7000 : 2500);
}

function describeError(err) {
  const code = (err && err.code) || '';
  if (code === 'auth/unauthorized-domain') {
    return `Sign-in is blocked for ${location.hostname}. In Firebase console, open Authentication > Settings > Authorized domains and add it.`;
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Google sign-in is turned off. Enable it in Firebase console under Authentication > Sign-in method.';
  }
  if (code === 'auth/network-request-failed') return 'No connection. Check your internet and try again.';
  if (code === 'permission-denied') {
    return 'The database refused access. If the app was just updated, publish the new rules from firestore.rules in Firebase console > Firestore > Rules. If you joined with a link, it may have been used already or expired.';
  }
  if (code === 'unavailable') return 'You are offline. Connect to the internet once so the app can set up your household.';
  return (err && err.message) || 'Something went wrong.';
}

// Fire a write without waiting for the server (writes queue while offline).
function save(promise, doneMessage) {
  if (doneMessage) toast(doneMessage);
  Promise.resolve(promise).catch((err) => {
    console.error(err);
    toast(describeError(err), 'error');
  });
}

async function copyText(text, doneMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(doneMessage);
  } catch {
    textDialog('Copy this', text);
  }
}

// ---------- routing ----------

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'l' && parts[1] && parts[2] === 'p' && parts[3]) {
    return { view: 'product', listId: parts[1], productId: parts[3] };
  }
  if (parts[0] === 'l' && parts[1]) return { view: 'list', listId: parts[1] };
  if (parts[0] === 'next') return { view: 'next', mode: parts[1] === 'sale' ? 'sale' : 'must' };
  if (parts[0] === 'add') return { view: 'add' };
  if (parts[0] === 'household') return { view: 'household' };
  return { view: 'lists' };
}

const listHref = (listId) => `#/l/${encodeURIComponent(listId)}`;
const productHref = (listId, pid) => `#/l/${encodeURIComponent(listId)}/p/${encodeURIComponent(pid)}`;

// An import link (…#import=…) or invite link (…#join=…) is held until the user is signed in.
function takeImportLink() {
  if (location.hash.startsWith('#import=')) state.pendingImport = location.hash;
  else if (location.hash.startsWith('#join=')) {
    const m = location.hash.slice(6).match(/^([A-Za-z0-9]{10,40})\.([a-z0-9]{20,40})$/);
    state.pendingJoin = m ? { hid: m[1], code: m[2] } : { bad: true };
  } else return;
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
}

let lastView = '';
window.addEventListener('hashchange', () => {
  takeImportLink();
  const before = lastView;
  render();
  if (before !== lastView) window.scrollTo(0, 0);
});

// ---------- data helpers ----------

const productsOf = (listId) => state.products.filter((p) => p.listId === listId);
const isSkip = (p) => !!(p.research && p.research.verdict === 'skip');
const isMust = (p) => !p.bought && !isSkip(p) && priorityOf(p) === 'must';
const isSale = (p) => !p.bought && !isSkip(p) && !!p.saleDay;

function sumEstimates(products) {
  let total = 0;
  let missing = 0;
  for (const p of products) {
    if (isSkip(p)) continue; // researched as not worth buying
    const est = productEstimate(p);
    if (est === null) missing += 1;
    else total += est;
  }
  return { total: Math.round(total * 100) / 100, missing };
}

// "Rice cooker 1.8 L (Panasonic SR-DA182)" → short name + model.
function splitName(name) {
  const m = String(name).match(/^(.{3,}?)\s*\(([^()]{2,})\)\s*$/);
  return m ? { short: m[1], model: m[2] } : { short: name, model: '' };
}

function productImage(p) {
  if (p.image) return p.image;
  const pick = pickListing(p);
  if (pick && pick.image) return pick.image;
  const any = (p.listings || []).find((l) => l.image);
  return any ? any.image : '';
}

function sellerLine(l) {
  if (!l) return '';
  const parts = [];
  if (l.shop) parts.push(l.shop);
  if (l.badge === 'mall' && !/mall/i.test(l.shop || '')) parts.push('Mall');
  else if (!l.shop && l.badge && l.badge !== 'none') parts.push(BADGES[l.badge]);
  if (Number.isFinite(l.rating)) parts.push(`★ ${l.rating.toFixed(1)}${Number.isFinite(l.ratingCount) ? ` (${formatCount(l.ratingCount)})` : ''}`);
  if (Number.isFinite(l.sold)) parts.push(`${formatCount(l.sold)} sold`);
  if (!l.shop && l.shipsFrom) parts.push(`from ${l.shipsFrom}`);
  return parts.join(' · ');
}

function initialOf(user) {
  return ((user && (user.displayName || user.email)) || '?').trim().charAt(0).toUpperCase();
}

function boughtPatch(bought) {
  const u = state.user || {};
  return bought
    ? { bought: true, boughtBy: { uid: u.uid || '', name: (u.displayName || u.email || '').slice(0, 60) }, boughtAt: Date.now() }
    : { bought: false, boughtBy: null, boughtAt: null };
}

function photo(src, cls = '', alt = '') {
  const box = h('div', { class: `photo ${cls}`.trim() });
  if (src) {
    const img = h('img', { src, alt, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => box.replaceChildren(icon('photo')), { once: true });
    box.append(img);
  } else {
    box.append(icon('photo'));
    box.setAttribute('aria-hidden', 'true');
  }
  return box;
}

// ---------- rendering ----------

let renderQueued = false;

function render() {
  // Don't rebuild the page underneath an open form.
  if (document.querySelector('dialog[open]')) {
    renderQueued = true;
    return;
  }
  renderQueued = false;
  renderHeader();

  let view;
  let route = { view: 'none' };
  if (state.user === undefined) view = loadingView('Checking sign-in…');
  else if (state.user === null) view = signInView();
  else if (state.dataError) view = errorView(state.dataError);
  else if (state.needsHousehold) view = loadingView('Opening your invite…');
  else if (!state.loaded) view = loadingView('Loading your lists…');
  else {
    route = parseRoute();
    if (route.view === 'product') view = productView(route.listId, route.productId);
    else if (route.view === 'list') view = listView(route.listId);
    else if (route.view === 'next') view = planView(route.mode);
    else if (route.view === 'add') view = addView();
    else if (route.view === 'household') view = householdView();
    else view = listsView();
  }
  lastView = `${route.view}:${route.listId || ''}:${route.productId || ''}`;
  renderTabbar(route.view);

  // Keep half-typed text and focus across re-renders caused by sync updates.
  const kept = {};
  main.querySelectorAll('[data-keep]').forEach((el) => { kept[el.dataset.keep] = el.value; });
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.keep : null;

  main.className = `container${route.view === 'list' || route.view === 'product' || route.view === 'add' ? ' has-totalbar' : ''}`;
  main.replaceChildren(view);

  main.querySelectorAll('[data-keep]').forEach((el) => {
    if (kept[el.dataset.keep] !== undefined) el.value = kept[el.dataset.keep];
  });
  if (focused) {
    const el = main.querySelector(`[data-keep="${focused}"]`);
    if (el) el.focus();
  }

  if (state.pendingJoin && state.user && (state.loaded || state.needsHousehold)) {
    const join = state.pendingJoin;
    state.pendingJoin = null;
    joinDialog(join);
    return;
  }
  if (state.pendingImport && state.user && state.loaded) {
    const text = state.pendingImport;
    state.pendingImport = null;
    importDialog(null, text);
  }
}

function renderHeader() {
  const user = state.user;
  if (!user || !state.loaded) {
    headerUser.replaceChildren();
    return;
  }
  const people = memberList().slice(0, 3);
  headerUser.replaceChildren(
    h('a', { class: 'avatars', href: '#/household', title: people.map((m) => m.name).join(', ') },
      h('span', { class: 'sr-only' }, `Household: ${people.map((m) => m.name).join(', ')}`),
      people.map((m, i) => (m.uid === user.uid && user.photoURL
        ? h('img', { class: 'avatar', src: user.photoURL, alt: '', referrerpolicy: 'no-referrer' })
        : h('span', { class: `avatar${i ? ' alt' : ''}`, 'aria-hidden': 'true' }, initialOf({ displayName: m.name }))))),
  );
}

// Members with you first; falls back to just you while the household loads.
function memberList() {
  const me = state.user;
  const list = state.members.length ? [...state.members] : [{ uid: me.uid, name: me.displayName || me.email || 'Me', role: 'owner' }];
  return list.sort((a, b) => (a.uid === me.uid ? -1 : b.uid === me.uid ? 1 : (a.joinedAt || 0) - (b.joinedAt || 0)));
}

function renderTabbar(view) {
  if (!state.user || !state.loaded) {
    tabbar.hidden = true;
    return;
  }
  tabbar.hidden = false;
  const tab = (href, label, name, on) => h('a', { href, 'aria-current': on ? 'page' : null }, icon(name), label);
  tabbar.replaceChildren(
    tab('#/', 'Lists', 'lists', view === 'lists' || view === 'list' || view === 'product' || view === 'add'),
    tab('#/next', 'Buy next', 'cart', view === 'next'),
    tab('#/household', 'Household', 'people', view === 'household'),
  );
}

function loadingView(text) {
  return h('div', { class: 'center' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), text);
}

function errorView(err) {
  return h('div', { class: 'card notice' },
    h('h2', {}, 'Could not load your data'),
    h('p', {}, describeError(err)),
    h('button', { class: 'btn', type: 'button', onClick: () => location.reload() }, 'Try again'),
  );
}

function signInView() {
  const status = h('p', { class: 'muted small', role: 'status' });
  const button = h('button', {
    class: 'btn primary big',
    type: 'button',
    onClick: async () => {
      button.disabled = true;
      status.textContent = 'Opening Google sign-in…';
      try {
        await store.signIn();
      } catch (err) {
        if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) {
          status.textContent = '';
        } else {
          status.textContent = describeError(err);
          status.className = 'error-text small';
        }
      } finally {
        button.disabled = false;
      }
    },
  }, 'Sign in with Google');

  return h('section', { class: 'card signin' },
    h('img', { class: 'signin-logo', src: 'img/logo-360.png', alt: 'Shopee List', width: 180, height: 180, fetchpriority: 'high' }),
    h('h1', { class: 'sr-only' }, 'Shopee List'),
    h('p', {}, 'Shopping lists for Shopee Malaysia, with photos, the reason behind each pick, and what to buy next.'),
    button,
    status,
    h('p', { class: 'muted small' }, state.pendingJoin ? 'Sign in to join the household you were invited to.' : 'Only you and the people you invite can see your lists.'),
  );
}

// ----- all lists -----

function listsView() {
  const lastChange = (list) => Math.max(list.updatedAt || 0, ...productsOf(list.id).map((p) => p.updatedAt || 0));
  const lists = [...state.lists].sort((a, b) => lastChange(b) - lastChange(a));

  const must = state.products.filter(isMust);
  const sale = state.products.filter(isSale);
  const next = nextSale();
  const mustLists = new Set(must.map((p) => p.listId)).size;

  const cards = lists.map((list) => {
    const items = productsOf(list.id);
    const bought = items.filter((p) => p.bought).length;
    const remaining = sumEstimates(items.filter((p) => !p.bought));
    const thumbs = items.filter((p) => !p.bought && !isSkip(p)).slice(0, 3);
    return h('a', { class: 'card list-card', href: listHref(list.id) },
      h('div', { class: 'thumbs', 'aria-hidden': 'true' },
        (thumbs.length ? thumbs : [{}]).map((p) => photo(p.id ? productImage(p) : '', 'xs'))),
      h('div', { class: 'main' },
        h('span', { class: 'name' }, list.name),
        h('span', { class: 'muted small' },
          `${items.length} item${items.length === 1 ? '' : 's'}`, bought ? ` · ${bought} bought` : '')),
      remaining.total > 0
        ? h('div', { class: 'side' }, h('span', { class: 'amount' }, formatRM(remaining.total)), h('span', { class: 'muted tiny' }, 'to buy'))
        : null,
    );
  });

  return h('div', { class: 'stack' },
    h('h1', { class: 'page-title' }, 'Your lists'),
    h('div', { class: 'hero-cta' },
      h('a', { class: 'btn primary big block', href: '#/add' }, icon('plus'), 'Add from Claude'),
      h('p', {}, 'From the research library, with photos and prices')),
    h('div', { class: 'summary-cards' },
      h('a', { class: 'card summary-card', href: '#/next' },
        h('span', { class: 'kicker' }, 'Buy next'),
        h('span', { class: 'big-num' }, formatRM(sumEstimates(must).total)),
        h('span', { class: 'muted' }, must.length
          ? `${must.length} must-have${must.length === 1 ? '' : 's'} in ${mustLists} list${mustLists === 1 ? '' : 's'}`
          : 'Mark items as Must-have')),
      h('a', { class: 'card summary-card sale', href: '#/next/sale' },
        h('span', { class: 'kicker' }, `${next.label} sale`),
        h('span', { class: 'big-num' }, formatRM(sumEstimates(sale).total)),
        h('span', { class: 'muted' }, `${sale.length} item${sale.length === 1 ? '' : 's'}, ${next.days === 0 ? 'today' : `in ${next.days} day${next.days === 1 ? '' : 's'}`}`))),
    h('div', { class: 'row-between' },
      h('h2', { style: 'font-size: 17px' }, `${lists.length} list${lists.length === 1 ? '' : 's'}`),
      h('span', { class: 'muted small' }, 'Recently changed first')),
    cards.length ? h('div', { class: 'stack tight' }, cards)
      : h('div', { class: 'card empty' }, h('p', {}, 'No lists yet. Tap Add from Claude, or make an empty list below.')),
    h('div', { class: 'secondary-actions' },
      h('button', { class: 'btn ghost small', type: 'button', onClick: newListDialog }, 'New empty list'),
      h('button', { class: 'btn ghost small', type: 'button', onClick: () => importDialog(null) }, 'Paste from chat')),
  );
}

function newListDialog() {
  formDialog({
    title: 'New list',
    submitLabel: 'Create',
    fields: [{ name: 'name', label: 'List name', placeholder: 'e.g. Raya, Kitchen', required: true, maxlength: 80, full: true }],
    onSubmit: ({ name }) => {
      const clean = name.trim();
      if (!clean) return 'Enter a name.';
      save(store.addList(clean), `Added list "${clean}"`);
      return null;
    },
  });
}

// ----- one list -----

function listView(listId) {
  const list = state.lists.find((l) => l.id === listId);
  if (!list) return notFound('This list no longer exists.');

  const items = productsOf(listId)
    .sort((a, b) => Number(a.bought) - Number(b.bought)
      || ['must', 'should', 'nice'].indexOf(priorityOf(a)) - ['must', 'should', 'nice'].indexOf(priorityOf(b))
      || (a.createdAt || 0) - (b.createdAt || 0));
  const open = items.filter((p) => !p.bought);
  const next = nextSale();
  const filters = {
    buy: { label: `To buy ${open.length}`, test: (p) => !p.bought },
    must: { label: `Must-have ${open.filter(isMust).length}`, test: isMust },
    sale: { label: `${next.label} sale ${open.filter(isSale).length}`, test: isSale },
    bought: { label: `Bought ${items.length - open.length}`, test: (p) => p.bought },
  };
  if (!filters[state.filter]) state.filter = 'buy';
  const shown = items.filter(filters[state.filter].test);
  const researched = items.map((p) => p.research && p.research.researchedAt).filter(Boolean).sort().pop();
  const boughtByOther = items.filter((p) => p.bought && p.boughtBy && p.boughtBy.uid && p.boughtBy.uid !== (state.user && state.user.uid));

  const rows = shown.map((p) => itemRow(listId, p));

  const more = () => menuDialog(list.name, [
    menuButton('Add an item yourself', () => addItemDialog(listId)),
    menuButton('Paste research from chat', () => importDialog(listId)),
    menuButton('Copy re-check request for Claude', () => copyText(recheckRequest(list.name, open), 'Copied. Paste it to Claude to re-check prices.')),
    menuButton('Rename list', () => renameListDialog(list)),
    menuButton('Delete list', () => {
      const ids = items.map((p) => p.id);
      if (!confirm(`Delete "${list.name}" and its ${ids.length} item(s)? This cannot be undone.`)) return;
      location.hash = '#/';
      save(store.deleteList(list.id, ids), 'List deleted');
    }, 'danger'),
  ]);

  const todo = sumEstimates(open);
  const mustTotal = sumEstimates(open.filter(isMust));

  return h('div', { class: 'stack' },
    h('div', { class: 'nav-row' },
      h('a', { class: 'back', href: '#/' }, icon('back'), 'Lists'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'More: add item, rename, delete', onClick: more }, icon('more'))),
    h('div', { class: 'list-head' },
      h('div', {},
        h('h1', { class: 'page-title' }, list.name),
        h('p', { class: 'page-sub' },
          `${items.length} item${items.length === 1 ? '' : 's'} · ${items.length - open.length} bought`,
          boughtByOther.length ? ` (${boughtByOther.length} by ${boughtByOther[0].boughtBy.name || 'someone else'})` : '',
          researched ? ` · researched ${formatDate(researched)}` : '')),
      items.length ? h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter items' },
        Object.entries(filters).map(([key, f]) => h('button', {
          type: 'button', 'aria-pressed': String(state.filter === key),
          onClick: () => { state.filter = key; render(); },
        }, f.label))) : null),
    shown.length ? h('ul', { class: 'items' }, rows)
      : h('div', { class: 'card empty' }, h('p', {}, items.length
        ? 'Nothing here for this filter.'
        : 'No items yet. Add research from Claude, or tap the ⋯ menu to add an item yourself.')),
    h('button', { class: 'btn ghost small', type: 'button', style: 'align-self: center', onClick: () => addItemDialog(listId) }, icon('plus'), 'Add an item yourself'),
    h('div', { class: 'totalbar' },
      h('div', { class: 'totalbar-inner' },
        h('div', {}, h('span', { class: 'label' }, 'Still to buy'), h('span', { class: 'value' }, formatRM(todo.total))),
        h('div', {}, h('span', { class: 'label', style: 'text-align: right' }, 'Must-haves'), h('span', { class: 'value must' }, formatRM(mustTotal.total))))),
  );
}

function itemRow(listId, p) {
  const listing = pickListing(p);
  const est = productEstimate(p);
  const { short, model } = splitName(p.name);
  const verdict = p.research && p.research.verdict;
  const pri = priorityOf(p);
  const why = firstSentence(p.research && p.research.summary) || firstSentence(p.notes);
  const meta = [model, sellerLine(listing)].filter(Boolean).join(' · ') || ((p.listings || []).length ? '' : 'No listings yet');
  const next = nextSale();

  const chips = [];
  if (!p.bought) chips.push(h('span', { class: `chip${pri === 'must' ? ' must' : ''}` }, PRIORITIES[pri]));
  if (verdict) chips.push(h('span', { class: `chip ${verdict}` }, VERDICTS[verdict]));
  if (p.saleDay && !p.bought) chips.push(h('span', { class: 'chip sale' }, next.label));
  if (p.bought) chips.push(h('span', { class: 'chip' }, `Bought${p.boughtBy && p.boughtBy.name ? ` by ${p.boughtBy.name.split(' ')[0]}` : ''}`));

  return h('li', { class: `card item${p.bought ? ' bought' : ''}` },
    h('a', { class: 'item-link', href: productHref(listId, p.id) },
      photo(productImage(p), '', ''),
      h('span', { class: 'item-text' },
        h('span', { class: 'item-top' },
          h('span', { class: 'item-name' }, short, p.qty > 1 ? ` ×${p.qty}` : ''),
          est !== null ? h('span', { class: 'item-price' }, formatRM(est)) : null),
        meta ? h('span', { class: 'item-meta' }, meta) : null,
        why ? h('span', { class: 'item-why' }, why) : null,
        h('span', { class: 'chips' }, chips))),
    h('button', {
      class: 'tick', type: 'button', 'aria-pressed': String(!!p.bought),
      'aria-label': `${p.bought ? 'Mark not bought' : 'Mark bought'}: ${p.name}`,
      onClick: () => save(store.updateProduct(p.id, boughtPatch(!p.bought)), p.bought ? null : `Bought: ${short}`),
    }, h('span', {}, icon('check'))),
  );
}

function notFound(message) {
  return h('div', { class: 'stack' },
    h('div', { class: 'nav-row' }, h('a', { class: 'back', href: '#/' }, icon('back'), 'Lists')),
    h('div', { class: 'card empty' }, h('p', {}, message)),
  );
}

function recheckRequest(listName, products) {
  const lines = products
    .map((p) => {
      const l = pickListing(p);
      return l && l.url ? `- ${p.name}: ${l.url}` : null;
    })
    .filter(Boolean);
  return [
    `Re-check these Shopee prices for my Shopee List (list "${listName}").`,
    'Open each link in my Chrome, read the current price, rating and sold count, and give me a Shopee List import block for the same list with the same item names, so the app records the new prices.',
    ...lines,
  ].join('\n');
}

// ----- one product -----

function productView(listId, productId) {
  const list = state.lists.find((l) => l.id === listId);
  const product = state.products.find((p) => p.id === productId && p.listId === listId);
  if (!list || !product) return notFound('This item no longer exists.');

  const qty = product.qty || 1;
  const { short, model } = splitName(product.name);
  const r = product.research;
  const pri = priorityOf(product);
  const next = nextSale();
  const pick = pickListing(product);

  const listings = [...(product.listings || [])].sort((a, b) => {
    if (a.id === product.chosenListingId) return -1;
    if (b.id === product.chosenListingId) return 1;
    const ta = listingTotal(a, qty);
    const tb = listingTotal(b, qty);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  });

  const more = () => menuDialog(short, [
    menuButton('Edit name, quantity, notes', () => editProductDialog(product)),
    menuButton('Add a listing', () => listingDialog(product)),
    menuButton('Delete item', () => {
      if (!confirm(`Delete "${product.name}" and its listings?`)) return;
      location.hash = listHref(listId);
      save(store.deleteProduct(product.id), 'Item deleted');
    }, 'danger'),
  ]);

  const chips = [];
  if (r && r.verdict) chips.push(h('span', { class: `chip big ${r.verdict}` }, VERDICTS[r.verdict]));
  chips.push(h('span', { class: `chip big${pri === 'must' ? ' must' : ''}` }, PRIORITIES[pri]));
  if (product.saleDay) chips.push(h('span', { class: 'chip big sale' }, next.label));
  if (qty > 1) chips.push(h('span', { class: 'chip big' }, `Qty ${qty}`));

  const bullets = (items, cls) => (items && items.length
    ? h('ul', { class: `bullets ${cls}` }, items.map((s) => h('li', {}, s))) : null);

  const why = (r && (r.summary || (r.pros && r.pros.length) || (r.cons && r.cons.length))) || product.notes
    ? h('section', { class: 'card pad why' },
      h('h2', { class: 'section-label', style: 'padding: 0 0 8px' }, r && r.summary ? "Why it's the pick" : 'Notes'),
      r && r.summary ? h('p', { class: 'summary-text' }, r.summary) : null,
      product.notes ? h('p', { class: 'muted small' }, r && r.summary ? `Note: ${product.notes}` : product.notes) : null,
      (r && ((r.pros && r.pros.length) || (r.cons && r.cons.length)))
        ? h('div', { class: 'pros-cons' },
          r.pros && r.pros.length ? h('div', {}, h('h3', {}, 'Good'), bullets(r.pros, 'pros')) : null,
          r.cons && r.cons.length ? h('div', {}, h('h3', {}, 'Watch out'), bullets(r.cons, 'cons')) : null)
        : null,
      r && r.sources && r.sources.length
        ? h('details', { class: 'sources' },
          h('summary', {}, `Sources (${r.sources.length})${r.researchedAt ? ` · researched ${formatDate(r.researchedAt)}` : ''}`),
          h('ul', {}, r.sources.map((s) => h('li', {},
            h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title || new URL(s.url).hostname)))))
        : (r && r.researchedAt ? h('p', { class: 'muted tiny', style: 'margin-top: 8px' }, `Researched ${formatDate(r.researchedAt)}`) : null))
    : null;

  return h('div', { class: 'stack' },
    h('div', { class: 'nav-row' },
      h('a', { class: 'back', href: listHref(listId) }, icon('back'), list.name),
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'More: edit, add listing, delete', onClick: more }, icon('more'))),
    photo(productImage(product), 'hero', product.name),
    h('div', { class: 'stack tight' },
      h('h1', { class: 'item-title' }, short),
      model ? h('p', { class: 'subtitle' }, model) : null,
      h('div', { class: 'chips' }, chips)),
    why,
    pick ? priceCard(product, pick, list.name) : null,
    h('section', { class: 'stack tight' },
      h('h2', { class: 'section-label' }, 'Priority'),
      h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Priority' },
        Object.entries(PRIORITIES).map(([key, label]) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(pri === key),
          onClick: () => { if (product.priority !== key) save(store.updateProduct(product.id, { priority: key })); },
        }, label))),
      h('button', {
        class: 'switch-row', type: 'button', role: 'switch', 'aria-checked': String(!!product.saleDay),
        onClick: () => save(store.updateProduct(product.id, { saleDay: !product.saleDay })),
      },
      h('span', {}, h('strong', {}, `Buy on ${next.label} sale`), h('span', { class: 'muted' }, next.days === 0 ? 'The sale is today' : `In ${next.days} day${next.days === 1 ? '' : 's'}. Shows in the sale list.`)),
      h('span', { class: 'switch', 'aria-hidden': 'true' }))),
    h('section', { class: 'stack tight' },
      h('div', { class: 'row-between' },
        h('h2', { class: 'section-label' }, listings.length ? `${listings.length} listing${listings.length === 1 ? '' : 's'} compared` : 'Listings'),
        h('button', { class: 'btn ghost small', type: 'button', onClick: () => listingDialog(product) }, icon('plus'), 'Add')),
      listings.length
        ? listings.map((l) => listingCard(product, l, listings))
        : h('div', { class: 'card empty' }, h('p', {}, 'No listings yet. Find this item on Shopee, copy the link, and add each seller you are considering.'))),
    h('div', { class: 'bottom-actions' },
      h('div', { class: 'inner' },
        h('button', {
          class: `btn big ${product.bought ? '' : 'dark'}`, type: 'button', 'aria-pressed': String(!!product.bought),
          onClick: () => save(store.updateProduct(product.id, boughtPatch(!product.bought)), product.bought ? 'Marked not bought' : 'Marked as bought'),
        }, product.bought
          ? `Bought${product.boughtBy && product.boughtBy.name ? ` by ${product.boughtBy.name.split(' ')[0]}` : ''} · tap to undo`
          : 'Mark as bought'))),
  );
}

function priceCard(product, pick, listName) {
  const qty = product.qty || 1;
  const hist = historyOf(pick);
  const first = hist[0];
  const last = hist[hist.length - 1];
  const lowest = hist.reduce((m, p) => (m === null || p.price < m ? p.price : m), null);
  const change = first && last ? Math.round((last.price - first.price) * 100) / 100 : 0;
  const lastDate = pick.checked && pick.checked !== 'card' ? pick.checked : (last && last.date) || '';
  const age = ageText(lastDate);

  let changeChip;
  if (hist.length < 2) changeChip = h('span', { class: 'chip big' }, 'No change yet');
  else if (change === 0) changeChip = h('span', { class: 'chip big' }, 'Same as research day');
  else changeChip = h('span', { class: `chip big ${change > 0 ? 'up' : 'down'}` }, `${change > 0 ? 'Up' : 'Down'} ${formatRM(Math.abs(change))}`);

  return h('section', { class: 'card pad price-card' },
    h('div', { class: 'row-between', style: 'align-items: flex-end' },
      h('div', {},
        h('span', { class: 'muted tiny', style: 'display: block' }, qty > 1 ? `Pick price ×${qty}` : 'Pick price'),
        h('span', { class: 'price-now' }, formatRM(listingTotal(pick, qty)))),
      changeChip),
    h('div', { class: 'price-grid' },
      h('div', {}, h('span', { class: 'muted' }, 'Research day'), h('strong', {}, first ? formatRM(first.price) : '–')),
      h('div', {}, h('span', { class: 'muted' }, 'Lowest seen'), h('strong', {}, lowest !== null ? formatRM(lowest) : '–')),
      h('div', {}, h('span', { class: 'muted' }, 'Checked'), h('strong', {}, lastDate ? `${formatDate(lastDate, true)}${age ? ` (${age})` : ''}` : '–'))),
    pick.checked === 'card'
      ? h('p', { class: 'muted tiny' }, 'Read from Shopee search results, not the product page. Re-check for the exact price.')
      : null,
    h('div', { class: 'stack tight' },
      h('button', { class: 'btn outline', type: 'button', onClick: () => recheckDialog(product, pick) }, icon('refresh'), 'Re-check price'),
      h('button', {
        class: 'btn ghost small', type: 'button',
        onClick: () => copyText(recheckRequest(listName, [product]), 'Copied. Paste it to Claude to re-check.'),
      }, icon('copy'), 'Copy re-check request for Claude')),
  );
}

function listingCard(product, l, all) {
  const qty = product.qty || 1;
  const isChosen = l.id === product.chosenListingId;
  const totals = all.map((x) => listingTotal(x, qty)).filter(Number.isFinite);
  const total = listingTotal(l, qty);
  const cheapest = all.length > 1 && total !== null && total === Math.min(...totals);
  const ship = Number.isFinite(l.shipping) ? (l.shipping === 0 ? 'Free shipping' : `Shipping ${formatRM(l.shipping)}`) : '';
  const tags = [];
  tags.push(h('span', { class: `chip ${isChosen ? 'solid' : ''}` }, isChosen ? 'Pick' : (TAGS[l.tag] && l.tag !== 'PICK' ? TAGS[l.tag] : 'Alternative')));
  if (cheapest) tags.push(h('span', { class: 'chip buy' }, 'Cheapest'));
  if (l.badge === 'mall') tags.push(h('span', { class: 'chip mall' }, 'Mall'));
  if (l.overseas) tags.push(h('span', { class: 'chip warn' }, 'Overseas'));

  return h('div', { class: `card listing${isChosen ? ' is-pick' : ''}` },
    h('div', { class: 'head' }, h('span', { class: 'chips' }, tags), h('span', { class: 'price' }, formatRM(total))),
    h('span', { class: 'shop' }, l.shop || BADGES[l.badge] || BADGES.none),
    h('span', { class: 'line' }, [
      l.shop && l.badge && l.badge !== 'none' && l.badge !== 'mall' ? BADGES[l.badge] : '',
      l.shipsFrom ? `ships from ${l.shipsFrom}` : '',
      ship,
    ].filter(Boolean).join(' · ') || ' '),
    h('span', { class: 'line' }, [
      Number.isFinite(l.rating) ? `★ ${l.rating.toFixed(1)}${Number.isFinite(l.ratingCount) ? ` (${formatCount(l.ratingCount)})` : ''}` : '',
      Number.isFinite(l.sold) ? `${formatCount(l.sold)} sold` : '',
      qty > 1 && Number.isFinite(l.price) ? `${formatRM(l.price)} each` : '',
    ].filter(Boolean).join(' · ') || 'No rating recorded'),
    l.voucher ? h('span', { class: 'line' }, `Voucher: ${l.voucher}`) : null,
    l.notes ? h('span', { class: 'line' }, l.notes) : null,
    h('div', { class: 'acts' },
      l.url ? h('a', { class: `btn ${isChosen ? 'primary' : ''}`, href: l.url, target: '_blank', rel: 'noopener noreferrer' }, icon('open'), 'Open in Shopee') : null,
      isChosen ? null : h('button', {
        class: 'btn', type: 'button',
        onClick: () => save(store.updateProduct(product.id, { chosenListingId: l.id }), 'Pick changed'),
      }, 'Make pick'),
      h('button', { class: 'btn ghost', type: 'button', onClick: () => listingDialog(product, l) }, 'Edit'),
      h('button', {
        class: 'btn ghost danger', type: 'button',
        onClick: () => {
          if (!confirm(`Delete listing from ${l.shop || 'this seller'}?`)) return;
          save(store.updateProduct(product.id, {
            listings: (product.listings || []).filter((x) => x.id !== l.id),
            chosenListingId: product.chosenListingId === l.id ? null : product.chosenListingId,
          }), 'Listing deleted');
        },
      }, 'Delete')),
  );
}

function formatDate(iso, short = false) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-MY', short ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

// ----- buy next -----

function planView(mode) {
  const next = nextSale();
  const picked = state.products.filter(mode === 'sale' ? isSale : isMust);
  const lists = [...state.lists].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const groups = lists
    .map((list) => ({ list, items: picked.filter((p) => p.listId === list.id) }))
    .filter((g) => g.items.length);
  const total = sumEstimates(picked).total;

  const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'View' },
    h('a', { href: '#/next', role: 'tab', 'aria-selected': String(mode !== 'sale'), class: 'seg-link' }, 'Must-haves'),
    h('a', { href: '#/next/sale', role: 'tab', 'aria-selected': String(mode === 'sale'), class: 'seg-link' }, `${next.label} sale`));

  const banner = h('div', { class: `banner${mode === 'sale' ? ' sale' : ''}` },
    h('span', { class: 'kicker' }, mode === 'sale' ? `${next.label} sale · ${next.days === 0 ? 'today' : `in ${next.days} day${next.days === 1 ? '' : 's'}`}` : 'Must-haves to buy'),
    h('span', { class: 'big-num' }, formatRM(total)),
    h('span', { class: 'sub' }, mode === 'sale'
      ? `${picked.length} item${picked.length === 1 ? '' : 's'} tagged for the sale`
      : `${picked.length} item${picked.length === 1 ? '' : 's'} in ${groups.length} list${groups.length === 1 ? '' : 's'}`));

  const empty = h('div', { class: 'card empty' }, h('p', {}, mode === 'sale'
    ? `Nothing tagged yet. Open an item and switch on "Buy on ${next.label} sale".`
    : 'No must-haves yet. Open an item and set its priority to Must-have.'));

  return h('div', { class: 'stack' },
    h('div', {},
      h('h1', { class: 'page-title' }, 'Buy next'),
      h('p', { class: 'page-sub' }, 'Must-haves first, across all lists. No budget limit.')),
    tabs,
    banner,
    groups.length ? groups.map((g) => h('section', { class: 'stack tight' },
      h('div', { class: 'row-between', style: 'padding: 0 4px' },
        h('h2', { style: 'font-size: 16px' }, g.list.name),
        h('span', { class: 'amount', style: 'color: var(--neutral-ink)' }, formatRM(sumEstimates(g.items).total))),
      h('div', { class: 'card group-card' }, g.items.map((p) => {
        const { short } = splitName(p.name);
        const l = pickListing(p);
        const est = productEstimate(p);
        return h('a', { class: 'plan-row', href: productHref(p.listId, p.id) },
          photo(productImage(p), 'sm'),
          h('span', { class: 'main' },
            h('span', { class: 'name' }, short, p.qty > 1 ? ` ×${p.qty}` : ''),
            h('span', { class: 'meta' }, sellerLine(l) || splitName(p.name).model || '')),
          est !== null ? h('span', { class: 'amount' }, formatRM(est)) : null);
      })))) : empty,
    mode === 'sale' && picked.length ? h('div', { class: 'stack tight' },
      h('button', {
        class: 'btn outline', type: 'button',
        onClick: () => copyText(recheckRequest(`${next.label} sale items`, picked), 'Copied. Paste it to Claude the day before the sale.'),
      }, icon('copy'), `Copy re-check request for these ${picked.length}`),
      h('p', { class: 'muted tiny', style: 'text-align: center' }, 'Do it the day before the sale. Shopee vouchers are not tracked.')) : null,
  );
}

// ----- add from Claude -----

async function loadLibrary() {
  if (state.library || state.libraryLoading) return;
  state.libraryLoading = true;
  try {
    const res = await fetch('research/index.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`The research library did not load (${res.status}).`);
    state.library = await res.json();
    state.libraryError = null;
  } catch (err) {
    state.libraryError = err;
  } finally {
    state.libraryLoading = false;
    render();
  }
}

function addView() {
  const head = h('div', { class: 'stack tight' },
    h('div', { class: 'nav-row' }, h('a', { class: 'back', href: '#/' }, icon('back'), 'Lists')),
    h('h1', { class: 'page-title' }, 'Add from Claude'),
    h('p', { class: 'page-sub' }, 'Pick researched lists. Photos, prices and reasons come with them.'),
    h('button', { class: 'btn ghost small', type: 'button', style: 'align-self: flex-start', onClick: () => importDialog(null) }, 'Or paste research from a chat'));

  if (!state.library) {
    if (!state.libraryError) loadLibrary();
    return h('div', { class: 'stack' }, head, state.libraryError
      ? h('div', { class: 'card notice' }, h('p', {}, state.libraryError.message),
        h('button', { class: 'btn', type: 'button', onClick: () => { state.libraryError = null; render(); } }, 'Try again'))
      : loadingView('Loading the research library…'));
  }

  const lib = state.library;
  const have = new Set(state.lists.map((l) => l.name.trim().toLowerCase()));
  const groups = lib.groups || [...new Set(lib.lists.map((l) => l.group || 'Lists'))];
  let count = 0;
  let items = 0;
  for (const l of lib.lists) {
    if (state.picked.has(l.file)) { count += 1; items += l.items; }
  }

  const sections = groups.map((g) => {
    const ls = lib.lists.filter((l) => (l.group || 'Lists') === g);
    if (!ls.length) return null;
    return h('section', { class: 'stack tight' },
      h('h2', { class: 'section-label' }, g),
      h('div', { class: 'card', style: 'overflow: hidden' }, ls.map((l) => {
        const on = state.picked.has(l.file);
        const added = have.has(l.name.trim().toLowerCase());
        return h('button', {
          type: 'button', role: 'checkbox', class: 'check-row', 'aria-checked': String(on),
          onClick: () => { if (on) state.picked.delete(l.file); else state.picked.add(l.file); render(); },
        },
        h('span', { class: 'box', 'aria-hidden': 'true' }, icon('check')),
        h('span', { class: 'main' },
          h('span', { class: 'name' }, l.name),
          h('span', { class: 'meta' }, `${l.items} items · ${added ? 'updates your list' : 'new list'}`)),
        added ? h('span', { class: 'chip buy' }, 'Added') : null);
      })));
  });

  const cta = h('button', {
    class: 'btn primary big block', type: 'button', disabled: !count,
    onClick: () => addPicked(cta),
  }, count ? `Add ${count} list${count === 1 ? '' : 's'} · ${items} items` : 'Pick a list to add');

  return h('div', { class: 'stack' },
    head,
    h('p', { class: 'muted tiny' }, `Library updated ${formatDate(lib.updated)}.`),
    sections.filter(Boolean),
    h('div', { class: 'sticky-cta' }, h('div', { class: 'inner' }, cta, h('p', {}, 'Lists you already have are updated, not duplicated.'))),
  );
}

async function addPicked(button) {
  const lib = state.library;
  const chosen = lib.lists.filter((l) => state.picked.has(l.file));
  if (!chosen.length) return;
  button.disabled = true;
  button.textContent = 'Adding…';
  let added = 0;
  let updated = 0;
  try {
    for (const entry of chosen) {
      const res = await fetch(`research/${entry.file}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Could not load ${entry.name} (${res.status}).`);
      const parsed = parseImport(await res.text());
      const existing = state.lists.find((l) => l.name.trim().toLowerCase() === parsed.listName.toLowerCase());
      const plan = planImport(parsed, existing ? productsOf(existing.id) : []);
      if (!plan.creates.length && !plan.updates.length) continue;
      const { done } = store.importItems(existing ? existing.id : null, parsed.listName, plan);
      save(done);
      added += plan.creates.length;
      updated += plan.updates.length;
    }
    state.picked.clear();
    toast(`Added ${added} item${added === 1 ? '' : 's'}${updated ? `, updated ${updated}` : ''}`);
    location.hash = '#/';
  } catch (err) {
    toast(describeError(err), 'error');
    button.disabled = false;
    render();
  }
}

// ----- household -----

function householdView() {
  const me = state.user;
  const hh = state.household || {};
  const isOwner = hh.ownerUid === me.uid;
  const people = memberList();
  const nameOf = (uidv) => {
    const m = state.members.find((x) => x.uid === uidv);
    return m ? m.name.split(' ')[0] : '';
  };
  const recent = state.products
    .filter((p) => p.bought && p.boughtAt)
    .sort((a, b) => b.boughtAt - a.boughtAt)
    .slice(0, 8);
  const listName = (id) => (state.lists.find((l) => l.id === id) || {}).name || '';

  const inviteBtn = h('button', {
    class: 'btn primary big block', type: 'button',
    onClick: async () => {
      inviteBtn.disabled = true;
      try {
        const link = await store.createInvite(me);
        const text = `Join our Shopee List so we share the same shopping lists: ${link}`;
        if (navigator.share) {
          try {
            await navigator.share({ title: 'Shopee List invite', text });
            toast('Invite sent');
          } catch (err) {
            if (err && err.name !== 'AbortError') await copyText(link, 'Invite link copied. Paste it in WhatsApp.');
          }
        } else {
          await copyText(link, 'Invite link copied. Paste it in WhatsApp.');
        }
      } catch (err) {
        toast(describeError(err), 'error');
      } finally {
        inviteBtn.disabled = false;
      }
    },
  }, icon('share'), 'Share invite link');

  return h('div', { class: 'stack' },
    h('div', {},
      h('h1', { class: 'page-title' }, 'Household'),
      h('p', { class: 'page-sub' }, `${hh.name || 'Your household'} · everyone here sees and edits the same lists.`)),
    h('section', { class: 'stack tight' },
      h('h2', { class: 'section-label' }, `${people.length} member${people.length === 1 ? '' : 's'}`),
      h('div', { class: 'card', style: 'overflow: hidden' }, people.map((m, i) => h('div', { class: 'plan-row' },
        h('span', { class: `avatar big${i ? ' alt' : ''}`, 'aria-hidden': 'true' }, initialOf({ displayName: m.name })),
        h('span', { class: 'main' },
          h('span', { class: 'name' }, m.name, m.uid === me.uid ? ' (you)' : ''),
          h('span', { class: 'meta' }, m.role === 'owner' ? 'Owner' : 'Can edit')),
        isOwner && m.uid !== me.uid ? h('button', {
          class: 'btn ghost small danger', type: 'button',
          onClick: () => {
            if (!confirm(`Remove ${m.name} from the household? They will no longer see these lists.`)) return;
            save(store.removeMember(m.uid), `${m.name} removed`);
          },
        }, 'Remove') : null)))),
    h('section', { class: 'card pad stack tight' },
      h('h2', { style: 'font-size: 16px' }, 'Invite someone'),
      h('p', { class: 'small', style: 'color: var(--text-2)' }, 'Send the link on WhatsApp. They sign in with their own Google account and join this household. The link works once and expires in 7 days.'),
      inviteBtn),
    recent.length ? h('section', { class: 'stack tight' },
      h('h2', { class: 'section-label' }, 'Recently bought'),
      h('div', { class: 'card', style: 'overflow: hidden' }, recent.map((p) => h('a', { class: 'plan-row', href: productHref(p.listId, p.id) },
        photo(productImage(p), 'sm'),
        h('span', { class: 'main' },
          h('span', { class: 'name' }, splitName(p.name).short),
          h('span', { class: 'meta' }, [
            p.boughtBy && (nameOf(p.boughtBy.uid) || (p.boughtBy.name || '').split(' ')[0]) ? `by ${nameOf(p.boughtBy.uid) || p.boughtBy.name.split(' ')[0]}` : '',
            listName(p.listId),
            new Date(p.boughtAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }),
          ].filter(Boolean).join(' · '))))))) : null,
    h('div', { class: 'card pad stack tight' },
      h('p', { class: 'muted small' }, `Signed in as ${me.email || me.displayName || ''}`),
      h('button', { class: 'btn', type: 'button', onClick: () => store.signOut().catch((err) => toast(describeError(err), 'error')) }, 'Sign out')),
  );
}

async function joinDialog(join) {
  const finish = () => {
    if (state.needsHousehold) {
      state.needsHousehold = false;
      startHousehold(state.user, false);
    } else render();
  };
  if (join.bad) {
    toast('That invite link is damaged. Ask for a new one.', 'error');
    finish();
    return;
  }
  if (join.hid === store.householdId()) {
    toast('You are already in this household.');
    finish();
    return;
  }
  let info;
  try {
    info = await store.lookupInvite(join.hid, join.code);
  } catch (err) {
    toast(describeError(err), 'error');
    finish();
    return;
  }
  if (!info || info.expired || (info.used && !info.usedByMe)) {
    toast(!info ? 'That invite link does not exist. Ask for a new one.'
      : info.expired ? 'That invite link has expired. Ask for a new one.'
        : 'That invite link was already used. Ask for a new one.', 'error');
    finish();
    return;
  }
  const mine = state.lists.length;
  const joinBtn = h('button', { class: 'btn primary', type: 'button' }, 'Join');
  const { dialog, close } = sheet(`Join ${info.from}'s household?`,
    h('div', { class: 'fields single' },
      h('p', {}, `You will see and edit the same lists as ${info.from}.`),
      mine ? h('p', { class: 'muted small' }, `Your ${mine} list${mine === 1 ? '' : 's'} will be copied into the shared household.`) : null),
    h('div', { class: 'sheet-foot' },
      h('button', { class: 'btn ghost', type: 'button', onClick: () => close() }, 'Not now'),
      joinBtn));
  let joined = false;
  joinBtn.addEventListener('click', async () => {
    joinBtn.disabled = true;
    joinBtn.textContent = 'Joining…';
    try {
      await store.joinHousehold(state.user, join.hid, join.code);
      joined = true;
      close();
      state.needsHousehold = false;
      startHousehold(state.user, true);
      toast(`You joined ${info.from}'s household`);
      location.hash = '#/';
    } catch (err) {
      joinBtn.disabled = false;
      joinBtn.textContent = 'Join';
      toast(describeError(err), 'error');
    }
  });
  dialog.addEventListener('close', () => { if (!joined) finish(); });
}

// ---------- dialogs ----------

function sheet(title, body, foot) {
  const dialog = h('dialog', { class: 'sheet', 'aria-label': title });
  const close = () => dialog.close();
  dialog.append(h('form', { method: 'dialog', novalidate: true, onSubmit: (e) => e.preventDefault() },
    h('div', { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', type: 'button', onClick: close, 'aria-label': 'Close' }, '✕')),
    body,
    foot || null));
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (renderQueued) render();
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close };
}

let closeMenu = null;
function menuButton(label, action, cls = '') {
  return h('button', {
    class: `btn ghost block ${cls}`.trim(), type: 'button',
    onClick: () => { if (closeMenu) closeMenu(); action(); },
  }, label);
}

function menuDialog(title, children) {
  const { close } = sheet(title, h('div', { class: 'menu-list' }, children));
  closeMenu = close;
}

function textDialog(title, text) {
  const area = h('textarea', { class: 'mono', rows: 8, readonly: true, 'aria-label': title });
  area.value = text;
  sheet(title, h('div', { class: 'fields single' }, h('p', { class: 'muted small' }, 'Select all and copy.'), area));
  area.select();
}

// fields: [{ name, label, type, value, options, placeholder, hint, required, inputmode, maxlength, full, node }]
// onSubmit(values) returns an error message to keep the dialog open, or nothing to close it.
function formDialog({ title, fields, submitLabel = 'Save', onSubmit }) {
  const errorEl = h('p', { class: 'error-text small', role: 'alert' });
  const inputs = {};

  const fieldEls = fields.map((f) => {
    if (f.type === 'node') return h('div', { class: 'field full' }, f.node);
    const id = `f-${f.name}`;
    let input;
    if (f.type === 'select') {
      input = h('select', { id, name: f.name },
        f.options.map(([value, label]) => h('option', { value, selected: value === f.value }, label)));
    } else if (f.type === 'textarea') {
      input = h('textarea', { id, name: f.name, rows: 2, maxlength: f.maxlength || 500, placeholder: f.placeholder });
      input.value = f.value || '';
    } else if (f.type === 'checkbox') {
      input = h('input', { id, name: f.name, type: 'checkbox', checked: !!f.value });
      inputs[f.name] = input;
      return h('label', { class: 'field check-field', for: id }, input, ' ', f.label);
    } else {
      input = h('input', {
        id, name: f.name, type: f.type || 'text', placeholder: f.placeholder, required: f.required,
        inputmode: f.inputmode, maxlength: f.maxlength || 200, autocomplete: 'off',
        min: f.min, max: f.max, step: f.step,
      });
      input.value = f.value === undefined || f.value === null ? '' : f.value;
    }
    inputs[f.name] = input;
    return h('div', { class: `field${f.full ? ' full' : ''}` },
      h('label', { for: id }, f.label),
      input,
      f.hint ? h('span', { class: 'hint' }, f.hint) : null,
    );
  });

  const dialog = h('dialog', { class: 'sheet', 'aria-label': title });
  const close = () => dialog.close();
  const form = h('form', {
    novalidate: true,
    onSubmit: (e) => {
      e.preventDefault();
      const values = {};
      for (const [name, el] of Object.entries(inputs)) values[name] = el.type === 'checkbox' ? el.checked : el.value;
      const problem = onSubmit(values);
      if (problem) {
        errorEl.textContent = problem;
        return;
      }
      close();
    },
  },
  h('div', { class: 'sheet-head' },
    h('h2', {}, title),
    h('button', { class: 'icon-btn', type: 'button', onClick: close, 'aria-label': 'Close' }, '✕')),
  h('div', { class: 'fields' }, fieldEls),
  errorEl,
  h('div', { class: 'sheet-foot' },
    h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Cancel'),
    h('button', { class: 'btn primary', type: 'submit' }, submitLabel)),
  );

  dialog.append(form);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (renderQueued) render();
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  const first = form.querySelector('input:not([type=checkbox]), select, textarea');
  if (first) first.focus();
  return dialog;
}

function addItemDialog(listId) {
  formDialog({
    title: 'Add an item',
    submitLabel: 'Add',
    fields: [
      { name: 'name', label: 'Item name', placeholder: 'e.g. Air fryer', required: true, maxlength: 120, full: true },
      { name: 'qty', label: 'Quantity', type: 'number', value: 1, min: 1, max: 999, step: 1, inputmode: 'numeric' },
    ],
    onSubmit: ({ name, qty }) => {
      const clean = name.trim();
      const n = Math.round(Number(qty) || 1);
      if (!clean) return 'Enter a name.';
      if (n < 1 || n > 999) return 'Quantity must be between 1 and 999.';
      save(store.addProduct(listId, { name: clean, qty: n }), `Added "${clean}"`);
      return null;
    },
  });
}

function renameListDialog(list) {
  formDialog({
    title: 'Rename list',
    fields: [{ name: 'name', label: 'List name', value: list.name, required: true, maxlength: 80, full: true }],
    onSubmit: ({ name }) => {
      const clean = name.trim();
      if (!clean) return 'Enter a name.';
      if (clean !== list.name) save(store.renameList(list.id, clean));
      return null;
    },
  });
}

function editProductDialog(product) {
  formDialog({
    title: 'Edit item',
    fields: [
      { name: 'name', label: 'Item name', value: product.name, required: true, maxlength: 120, full: true },
      { name: 'qty', label: 'Quantity', type: 'number', value: product.qty || 1, min: 1, max: 999, step: 1, inputmode: 'numeric' },
      { name: 'notes', label: 'Notes', type: 'textarea', value: product.notes || '', placeholder: 'Size, colour, who it is for…', full: true },
    ],
    onSubmit: ({ name, qty, notes }) => {
      const clean = name.trim();
      const n = Math.round(Number(qty));
      if (!clean) return 'Enter a name.';
      if (!Number.isFinite(n) || n < 1 || n > 999) return 'Quantity must be between 1 and 999.';
      save(store.updateProduct(product.id, { name: clean, qty: n, notes: notes.trim() }));
      return null;
    },
  });
}

// A listing with a new price: record it in the history and mark it checked today.
function withNewPrice(listing, price) {
  const today = todayISO();
  const hist = historyOf(listing);
  const last = hist[hist.length - 1];
  if (!last || last.price !== price || last.date !== today) hist.push({ date: today, price });
  return { ...listing, price, checked: today, history: hist.slice(-30) };
}

function recheckDialog(product, listing) {
  const link = listing.url
    ? h('a', { class: 'btn outline block', href: listing.url, target: '_blank', rel: 'noopener noreferrer' }, icon('open'), 'Open in Shopee')
    : h('p', { class: 'muted small' }, 'This listing has no link saved.');
  formDialog({
    title: 'Re-check price',
    submitLabel: 'Save price',
    fields: [
      { type: 'node', node: h('div', { class: 'stack tight' }, h('p', { class: 'muted small' }, `1. Open the listing and read the price for your variant. 2. Type it below. Last price: ${formatRM(listing.price)}.`), link) },
      { name: 'price', label: 'Price now (RM)', value: listing.price, inputmode: 'decimal', required: true, full: true },
    ],
    onSubmit: ({ price }) => {
      const p = parseMoney(price);
      if (p === null || Number.isNaN(p)) return 'Enter the price, e.g. 294.00.';
      const latest = state.products.find((x) => x.id === product.id) || product;
      const listings = (latest.listings || []).map((x) => (x.id === listing.id ? withNewPrice(x, p) : x));
      const diff = Math.round((p - listing.price) * 100) / 100;
      save(store.updateProduct(product.id, { listings }),
        diff === 0 ? 'Same price. Checked today.' : `Price ${diff > 0 ? 'up' : 'down'} ${formatRM(Math.abs(diff))}`);
      return null;
    },
  });
}

function listingDialog(product, existing) {
  const l = existing || {};
  formDialog({
    title: existing ? 'Edit listing' : 'Add listing',
    submitLabel: existing ? 'Save' : 'Add',
    fields: [
      { name: 'url', label: 'Shopee link', type: 'url', value: l.url, placeholder: 'https://shopee.com.my/…', inputmode: 'url', maxlength: 2000, full: true, hint: 'In the Shopee app: Share › Copy link.' },
      { name: 'shop', label: 'Shop name', value: l.shop, placeholder: 'e.g. Xiaomi Official Store', maxlength: 100, full: true },
      { name: 'price', label: 'Price per unit (RM)', value: l.price, placeholder: '0.00', inputmode: 'decimal', required: true },
      { name: 'shipping', label: 'Shipping (RM)', value: l.shipping, placeholder: '0 = free', inputmode: 'decimal' },
      { name: 'rating', label: 'Rating (0–5)', value: l.rating, placeholder: '4.9', inputmode: 'decimal' },
      { name: 'ratingCount', label: 'No. of ratings', value: countText(l.ratingCount), placeholder: 'e.g. 1.2k', inputmode: 'text' },
      { name: 'sold', label: 'Sold', value: countText(l.sold), placeholder: 'e.g. 10k', inputmode: 'text' },
      {
        name: 'badge', label: 'Seller type', type: 'select', value: l.badge || 'none',
        options: Object.entries(BADGES),
      },
      { name: 'shipsFrom', label: 'Ships from', value: l.shipsFrom, placeholder: 'e.g. Selangor', maxlength: 60 },
      { name: 'overseas', label: 'Ships from overseas', type: 'checkbox', value: l.overseas },
      { name: 'voucher', label: 'Vouchers', type: 'textarea', value: l.voucher, placeholder: 'e.g. RM5 off min spend RM50, free shipping voucher', full: true },
      { name: 'notes', label: 'Notes', type: 'textarea', value: l.notes, placeholder: 'Variant, colour, warranty…', full: true },
    ],
    onSubmit: (v) => {
      const url = cleanUrl(v.url);
      if (url === null) return 'The link must start with https://';
      const price = parseMoney(v.price);
      if (price === null) return 'Enter the price.';
      if (Number.isNaN(price)) return 'Price must be a number, e.g. 29.90.';
      const shipping = parseMoney(v.shipping);
      if (Number.isNaN(shipping)) return 'Shipping must be a number, e.g. 4.90 or 0.';
      const rating = parseRating(v.rating);
      if (Number.isNaN(rating)) return 'Rating must be between 0 and 5.';
      const ratingCount = parseCount(v.ratingCount);
      if (Number.isNaN(ratingCount)) return 'No. of ratings should look like 856 or 1.2k.';
      const sold = parseCount(v.sold);
      if (Number.isNaN(sold)) return 'Sold should look like 856 or 10k.';

      let listing = {
        ...l, // keep research fields such as tag, checked, image and history
        id: l.id || newId(),
        url,
        shop: v.shop.trim(),
        price: existing ? l.price : price,
        shipping,
        rating,
        ratingCount,
        sold,
        badge: BADGES[v.badge] ? v.badge : 'none',
        shipsFrom: v.shipsFrom.trim(),
        overseas: !!v.overseas,
        voucher: v.voucher.trim(),
        notes: v.notes.trim(),
      };
      // A price typed in by hand counts as checked today and goes into the history.
      if (!existing || price !== l.price) listing = withNewPrice(listing, price);
      // Use the latest copy in case another device changed this item while the form was open.
      const latest = state.products.find((p) => p.id === product.id) || product;
      const current = latest.listings || [];
      const listings = existing ? current.map((x) => (x.id === listing.id ? listing : x)) : [...current, listing];
      const patch = { listings };
      if (!existing && !latest.chosenListingId && !current.length) patch.chosenListingId = listing.id;
      save(store.updateProduct(product.id, patch), existing ? 'Listing saved' : 'Listing added');
      if (url && !isShopeeMY(url)) toast('Saved. Note: that link is not a shopee.com.my link.');
      return null;
    },
  });
}

function countText(n) {
  return Number.isFinite(n) ? String(n) : '';
}

// Paste research from Claude (or open an import link) and add every item in one go.
function importDialog(fromListId, initialText = '') {
  const textarea = h('textarea', {
    rows: 6, class: 'mono', spellcheck: 'false', 'aria-label': 'Import data',
    placeholder: 'Paste the import block or link from Claude here',
  });
  textarea.value = initialText;
  const preview = h('div', { class: 'import-preview', 'aria-live': 'polite' });
  const errorEl = h('p', { class: 'error-text small', role: 'alert' });
  const target = h('select', { 'aria-label': 'Add to list' });
  const targetField = h('div', { class: 'field', hidden: true }, h('label', {}, 'Add to list'), target);
  const submit = h('button', { class: 'btn primary', type: 'submit', disabled: true }, 'Import');
  let parsed = null;

  const plan = () => {
    const listId = target.value === '__new' ? null : target.value;
    const existing = listId ? productsOf(listId) : [];
    return { listId, ...planImport(parsed, existing) };
  };

  const refreshPreview = () => {
    if (!parsed) return;
    const { creates, updates } = plan();
    const listingCount = [...creates.map((i) => i.listings.length), ...updates.map((u) => u.added)].reduce((a, b) => a + b, 0);
    const repriced = updates.reduce((a, u) => a + (u.repriced || 0), 0);
    const verdicts = parsed.items.reduce((acc, i) => {
      const v = i.research && i.research.verdict;
      if (v) acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {});
    preview.replaceChildren(...[
      h('p', {},
        h('strong', {}, `${creates.length} new item${creates.length === 1 ? '' : 's'}`),
        updates.length ? `, ${updates.length} existing item${updates.length === 1 ? '' : 's'} updated` : '',
        `, ${listingCount} new listing${listingCount === 1 ? '' : 's'}`,
        repriced ? `, ${repriced} price change${repriced === 1 ? '' : 's'}` : '',
        '.'),
      Object.keys(verdicts).length
        ? h('p', { class: 'muted small' }, Object.entries(verdicts).map(([v, n]) => `${n} ${VERDICTS[v].toLowerCase()}`).join(' · '))
        : null,
      h('ul', { class: 'import-items' }, parsed.items.slice(0, 12).map((i) => h('li', {},
        i.name,
        i.research && i.research.verdict ? h('span', { class: `chip ${i.research.verdict}`, style: 'margin-left: 6px' }, VERDICTS[i.research.verdict]) : null))),
      parsed.items.length > 12 ? h('p', { class: 'muted tiny' }, `and ${parsed.items.length - 12} more`) : null,
    ].filter(Boolean));
  };

  const check = () => {
    errorEl.textContent = '';
    preview.replaceChildren();
    parsed = null;
    submit.disabled = true;
    targetField.hidden = true;
    if (!textarea.value.trim()) return;
    try {
      parsed = parseImport(textarea.value);
    } catch (err) {
      errorEl.textContent = err.message;
      return;
    }
    const lists = [...state.lists].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const sameName = lists.find((l) => l.name.trim().toLowerCase() === parsed.listName.toLowerCase());
    const preferred = fromListId || (sameName && sameName.id) || '__new';
    target.replaceChildren(
      h('option', { value: '__new' }, `New list: ${parsed.listName}`),
      ...lists.map((l) => h('option', { value: l.id }, l.name)),
    );
    target.value = preferred;
    targetField.hidden = false;
    submit.disabled = false;
    refreshPreview();
  };

  textarea.addEventListener('input', check);
  target.addEventListener('change', refreshPreview);

  const dialog = h('dialog', { class: 'sheet', 'aria-label': 'Paste from chat' });
  const close = () => dialog.close();
  const form = h('form', {
    novalidate: true,
    onSubmit: (e) => {
      e.preventDefault();
      if (!parsed) return;
      const p = plan();
      if (!p.creates.length && !p.updates.some((u) => u.added || u.repriced || u.patch.research)) {
        errorEl.textContent = 'Nothing new to import: these items and links are already in that list.';
        return;
      }
      const { listId, done } = store.importItems(p.listId, parsed.listName, p);
      save(done, `Imported ${parsed.items.length} item${parsed.items.length === 1 ? '' : 's'}`);
      close();
      location.hash = listHref(listId);
    },
  },
  h('div', { class: 'sheet-head' },
    h('h2', {}, 'Paste from chat'),
    h('button', { class: 'icon-btn', type: 'button', onClick: close, 'aria-label': 'Close' }, '✕')),
  h('div', { class: 'fields single' },
    h('p', { class: 'muted small' }, 'Paste the import block or link Claude gave you. Every item is added with its photo, listings and research.'),
    textarea,
    targetField,
    preview),
  errorEl,
  h('div', { class: 'sheet-foot' },
    h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Cancel'),
    submit),
  );

  dialog.append(form);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (renderQueued) render();
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  if (initialText) check();
  else textarea.focus();
}

// ---------- start ----------

takeImportLink();

function stopAll() {
  if (state.stopWatching) state.stopWatching();
  state.stopWatching = null;
}

// Open (or create) the household, then listen to its lists and members.
async function startHousehold(user, alreadyOpen) {
  stopAll();
  state.loaded = false;
  state.dataError = null;
  render();
  try {
    if (!alreadyOpen) {
      const hid = await store.openHousehold(user, { deferCreate: !!state.pendingJoin });
      if (!hid) {
        state.needsHousehold = true;
        render();
        return;
      }
    }
  } catch (err) {
    console.error(err);
    state.dataError = err;
    render();
    return;
  }
  if (state.user !== user) return; // signed out meanwhile
  let handled = false;
  const onError = (err) => {
    if (handled) return;
    handled = true;
    // Removed from the household while the app was open: find out where this person
    // belongs now (their own household, created fresh if needed) instead of showing an error.
    if (err && err.code === 'permission-denied' && !state.recovering) {
      state.recovering = true;
      toast('You are no longer in that household.', 'error');
      startHousehold(user, false).finally(() => { state.recovering = false; });
      return;
    }
    console.error(err);
    state.dataError = err;
    render();
  };
  const stopData = store.watchAll(({ lists, products }) => {
    state.lists = lists;
    state.products = products;
    state.loaded = true;
    render();
  }, onError);
  const stopHousehold = store.watchHousehold(({ household, members }) => {
    state.household = household;
    state.members = members;
    render();
  }, onError);
  state.stopWatching = () => { stopData(); stopHousehold(); };
}

store.onUser((user) => {
  stopAll();
  state.user = user;
  state.lists = [];
  state.products = [];
  state.members = [];
  state.household = null;
  state.loaded = false;
  state.needsHousehold = false;
  state.dataError = null;
  if (user) startHousehold(user, false);
  render();
});

render();
