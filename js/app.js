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
} from './util.js';
import { parseImport, planImport, VERDICTS, TAGS } from './importer.js';

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
  filter: 'all',
  stopWatching: null,
  dataError: null,
};

const main = document.getElementById('main');
const headerUser = document.getElementById('header-user');
const toastEl = document.getElementById('toast');

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
    return 'The database refused access. Publish the rules from firestore.rules in Firebase console > Firestore > Rules.';
  }
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

// ---------- routing ----------

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'l' && parts[1] && parts[2] === 'p' && parts[3]) {
    return { view: 'product', listId: parts[1], productId: parts[3] };
  }
  if (parts[0] === 'l' && parts[1]) return { view: 'list', listId: parts[1] };
  return { view: 'lists' };
}

const listHref = (listId) => `#/l/${encodeURIComponent(listId)}`;
const productHref = (listId, pid) => `#/l/${encodeURIComponent(listId)}/p/${encodeURIComponent(pid)}`;

// An import link (…#import=…) is held until the user is signed in and data has loaded.
function takeImportLink() {
  if (!location.hash.startsWith('#import=')) return;
  state.pendingImport = location.hash;
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
}

window.addEventListener('hashchange', () => {
  takeImportLink();
  render();
  window.scrollTo(0, 0);
});

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
  if (state.user === undefined) view = loadingView('Checking sign-in…');
  else if (state.user === null) view = signInView();
  else if (state.dataError) view = errorView(state.dataError);
  else if (!state.loaded) view = loadingView('Loading your lists…');
  else {
    const route = parseRoute();
    if (route.view === 'product') view = productView(route.listId, route.productId);
    else if (route.view === 'list') view = listView(route.listId);
    else view = listsView();
  }

  // Keep half-typed text and focus across re-renders caused by sync updates.
  const kept = {};
  main.querySelectorAll('[data-keep]').forEach((el) => { kept[el.dataset.keep] = el.value; });
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.keep : null;

  main.replaceChildren(view);

  main.querySelectorAll('[data-keep]').forEach((el) => {
    if (kept[el.dataset.keep] !== undefined) el.value = kept[el.dataset.keep];
  });
  if (focused) {
    const el = main.querySelector(`[data-keep="${focused}"]`);
    if (el) el.focus();
  }

  if (state.pendingImport && state.user && state.loaded) {
    const text = state.pendingImport;
    state.pendingImport = null;
    importDialog(null, text);
  }
}

function renderHeader() {
  const user = state.user;
  if (!user) {
    headerUser.replaceChildren();
    return;
  }
  const initial = (user.displayName || user.email || '?').trim().charAt(0).toUpperCase();
  const avatar = user.photoURL
    ? h('img', { class: 'avatar', src: user.photoURL, alt: '', referrerpolicy: 'no-referrer' })
    : h('span', { class: 'avatar', 'aria-hidden': 'true' }, initial);
  headerUser.replaceChildren(
    avatar,
    h('button', {
      class: 'btn ghost small',
      type: 'button',
      title: user.email || '',
      onClick: () => {
        if (confirm('Sign out?')) store.signOut().catch((err) => toast(describeError(err), 'error'));
      },
    }, 'Sign out'),
  );
}

function loadingView(text) {
  return h('div', { class: 'center muted' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), text);
}

function errorView(err) {
  return h('div', { class: 'card notice error' },
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
    h('h1', {}, 'Shopee List'),
    h('p', {}, 'Keep shopping lists for Shopee Malaysia and compare listings side by side. Your lists sync between your phone and computer.'),
    button,
    status,
    h('p', { class: 'muted small' }, 'Only your Google account can see your lists.'),
  );
}

// ----- all lists -----

function listsView() {
  const lists = [...state.lists].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const input = h('input', {
    type: 'text', name: 'name', placeholder: 'New list, e.g. Raya, Kitchen', maxlength: 80,
    required: true, autocomplete: 'off', 'data-keep': 'new-list', 'aria-label': 'New list name',
  });
  const form = h('form', {
    class: 'add-row',
    onSubmit: (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      input.value = '';
      save(store.addList(name), `Added list "${name}"`);
    },
  }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Add list'));

  const cards = lists.map((list) => {
    const items = state.products.filter((p) => p.listId === list.id);
    const bought = items.filter((p) => p.bought).length;
    const remaining = sumEstimates(items.filter((p) => !p.bought));
    return h('a', { class: 'card link-card', href: listHref(list.id) },
      h('div', { class: 'link-card-main' },
        h('h2', {}, list.name),
        h('p', { class: 'muted small' },
          `${items.length} item${items.length === 1 ? '' : 's'}`,
          items.length ? ` · ${bought} bought` : ''),
      ),
      h('div', { class: 'link-card-side' },
        remaining.total > 0 ? h('span', { class: 'amount' }, formatRM(remaining.total)) : null,
        remaining.total > 0 ? h('span', { class: 'muted tiny' }, 'to buy') : null,
      ),
      h('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'),
    );
  });

  return h('div', { class: 'stack' },
    h('div', { class: 'title-row' },
      h('h1', { class: 'page-title' }, 'Your lists'),
      h('div', { class: 'row-actions' },
        h('a', { class: 'btn small ghost', href: 'research/' }, 'Research library'),
        h('button', { class: 'btn small', type: 'button', onClick: () => importDialog(null) }, 'Import from Claude'))),
    form,
    cards.length ? h('div', { class: 'stack' }, cards)
      : h('div', { class: 'card empty' }, h('p', {}, 'No lists yet. Create one above to start adding Shopee items.')),
  );
}

function sumEstimates(products) {
  let total = 0;
  let missing = 0;
  for (const p of products) {
    if (p.research && p.research.verdict === 'skip') continue; // researched as not worth buying
    const est = productEstimate(p);
    if (est === null) missing += 1;
    else total += est;
  }
  return { total: Math.round(total * 100) / 100, missing };
}

// ----- one list -----

function listView(listId) {
  const list = state.lists.find((l) => l.id === listId);
  if (!list) return notFound('This list no longer exists.');

  const items = state.products
    .filter((p) => p.listId === listId)
    .sort((a, b) => Number(a.bought) - Number(b.bought) || (a.createdAt || 0) - (b.createdAt || 0));
  const shown = items.filter((p) => (state.filter === 'todo' ? !p.bought : state.filter === 'bought' ? p.bought : true));
  const all = sumEstimates(items);
  const todo = sumEstimates(items.filter((p) => !p.bought));

  const nameInput = h('input', {
    type: 'text', name: 'name', placeholder: 'Add item, e.g. Air fryer', maxlength: 120,
    required: true, autocomplete: 'off', 'data-keep': `new-item-${listId}`, 'aria-label': 'Item name',
  });
  const qtyInput = h('input', {
    type: 'number', name: 'qty', value: 1, min: 1, max: 999, step: 1, inputmode: 'numeric',
    class: 'qty', 'aria-label': 'Quantity',
  });
  const addForm = h('form', {
    class: 'add-row',
    onSubmit: (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      const qty = Math.min(999, Math.max(1, Math.round(Number(qtyInput.value) || 1)));
      if (!name) return;
      nameInput.value = '';
      qtyInput.value = 1;
      save(store.addProduct(listId, { name, qty }), `Added "${name}"`);
      nameInput.focus();
    },
  }, nameInput, qtyInput, h('button', { class: 'btn primary', type: 'submit' }, 'Add'));

  const filterBtn = (key, label) => h('button', {
    type: 'button',
    class: `chip${state.filter === key ? ' active' : ''}`,
    'aria-pressed': String(state.filter === key),
    onClick: () => { state.filter = key; render(); },
  }, label);

  const rows = shown.map((p) => {
    const listing = pickListing(p);
    const est = productEstimate(p);
    const count = (p.listings || []).length;
    const check = h('input', {
      type: 'checkbox', checked: !!p.bought, 'aria-label': `Mark ${p.name} as bought`,
      onChange: (e) => save(store.updateProduct(p.id, { bought: e.target.checked })),
    });
    return h('li', { class: `item${p.bought ? ' bought' : ''}` },
      h('label', { class: 'check' }, check),
      h('a', { class: 'item-main', href: productHref(listId, p.id) },
        h('span', { class: 'item-name' },
          p.name,
          p.research && p.research.verdict
            ? h('span', { class: `verdict-badge ${p.research.verdict}` }, VERDICTS[p.research.verdict]) : null),
        h('span', { class: 'muted small' },
          p.qty > 1 ? `Qty ${p.qty} · ` : '',
          count ? `${count} listing${count === 1 ? '' : 's'}` : 'No listings yet',
          listing && p.chosenListingId === listing.id ? ' · chosen' : ''),
      ),
      h('span', { class: 'item-price' }, est !== null ? formatRM(est) : ''),
      h('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'),
    );
  });

  return h('div', { class: 'stack' },
    h('a', { class: 'back', href: '#/' }, '‹ All lists'),
    h('div', { class: 'title-row' },
      h('h1', { class: 'page-title' }, list.name),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost small', type: 'button', onClick: () => importDialog(list.id) }, 'Import'),
        h('button', { class: 'btn ghost small', type: 'button', onClick: () => renameListDialog(list) }, 'Rename'),
        h('button', {
          class: 'btn ghost small danger', type: 'button',
          onClick: () => {
            const ids = items.map((p) => p.id);
            if (!confirm(`Delete "${list.name}" and its ${ids.length} item(s)? This cannot be undone.`)) return;
            location.hash = '#/';
            save(store.deleteList(list.id, ids), 'List deleted');
          },
        }, 'Delete'),
      ),
    ),
    h('div', { class: 'summary card' },
      stat('Items', `${items.filter((p) => p.bought).length}/${items.length} bought`),
      stat('Still to buy', formatRM(todo.total)),
      stat('Whole list', formatRM(all.total)),
      all.missing ? h('p', { class: 'muted tiny full' }, `${all.missing} item(s) have no priced listing yet and are not counted.`) : null,
    ),
    addForm,
    items.length ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter items' },
      filterBtn('all', 'All'), filterBtn('todo', 'To buy'), filterBtn('bought', 'Bought')) : null,
    shown.length ? h('ul', { class: 'items card' }, rows)
      : h('div', { class: 'card empty' }, h('p', {}, items.length ? 'Nothing here for this filter.' : 'No items yet. Add what you want to buy above.')),
  );
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('span', { class: 'muted tiny' }, label), h('strong', {}, value));
}

function notFound(message) {
  return h('div', { class: 'stack' },
    h('a', { class: 'back', href: '#/' }, '‹ All lists'),
    h('div', { class: 'card empty' }, h('p', {}, message)),
  );
}

// ----- one product: compare listings -----

function productView(listId, productId) {
  const list = state.lists.find((l) => l.id === listId);
  const product = state.products.find((p) => p.id === productId && p.listId === listId);
  if (!list || !product) return notFound('This item no longer exists.');

  const qty = product.qty || 1;
  const listings = [...(product.listings || [])].sort((a, b) => {
    const ta = listingTotal(a, qty);
    const tb = listingTotal(b, qty);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  });

  const header = h('div', { class: 'stack tight' },
    h('a', { class: 'back', href: listHref(listId) }, `‹ ${list.name}`),
    h('div', { class: 'title-row' },
      h('h1', { class: 'page-title' }, product.name),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost small', type: 'button', onClick: () => editProductDialog(product) }, 'Edit'),
        h('button', {
          class: 'btn ghost small danger', type: 'button',
          onClick: () => {
            if (!confirm(`Delete "${product.name}" and its listings?`)) return;
            location.hash = listHref(listId);
            save(store.deleteProduct(product.id), 'Item deleted');
          },
        }, 'Delete'),
      ),
    ),
    h('div', { class: 'meta-row' },
      h('span', { class: 'pill' }, `Qty ${qty}`),
      h('label', { class: 'pill toggle' },
        h('input', {
          type: 'checkbox', checked: !!product.bought,
          onChange: (e) => save(store.updateProduct(product.id, { bought: e.target.checked })),
        }),
        ' Bought'),
      productEstimate(product) !== null
        ? h('span', { class: 'pill strong' }, `Est. ${formatRM(productEstimate(product))}`) : null,
    ),
    product.notes ? h('p', { class: 'notes' }, product.notes) : null,
  );

  const addBtn = h('button', { class: 'btn primary', type: 'button', onClick: () => listingDialog(product) }, '+ Add listing');

  const body = listings.length
    ? compareTable(product, listings)
    : h('div', { class: 'card empty' },
      h('p', {}, 'No listings yet. Find this item on Shopee, copy the link, and add each seller you are considering.'));

  return h('div', { class: 'stack' },
    header,
    product.research ? researchCard(product.research) : null,
    h('div', { class: 'title-row' }, h('h2', { class: 'section-title' }, `Compare listings (${listings.length})`), addBtn),
    body,
    listings.length > 1 ? h('p', { class: 'muted tiny' }, 'Sorted by total. Total = price × quantity + shipping. Scroll sideways to see more.') : null,
  );
}

function researchCard(r) {
  const bullets = (items, cls) => (items && items.length
    ? h('ul', { class: `bullets ${cls}` }, items.map((s) => h('li', {}, s))) : null);
  return h('section', { class: 'card research', 'aria-label': 'Research' },
    h('div', { class: 'research-head' },
      r.verdict ? h('span', { class: `verdict ${r.verdict}` }, VERDICTS[r.verdict]) : null,
      h('span', { class: 'muted tiny' }, r.researchedAt ? `Researched ${formatDate(r.researchedAt)}` : 'Research')),
    r.summary ? h('p', { class: 'research-summary' }, r.summary) : null,
    (r.pros && r.pros.length) || (r.cons && r.cons.length)
      ? h('div', { class: 'pros-cons' },
        r.pros && r.pros.length ? h('div', {}, h('h3', {}, 'Good'), bullets(r.pros, 'pros')) : null,
        r.cons && r.cons.length ? h('div', {}, h('h3', {}, 'Watch out'), bullets(r.cons, 'cons')) : null)
      : null,
    r.sources && r.sources.length
      ? h('details', { class: 'sources' },
        h('summary', {}, `Sources (${r.sources.length})`),
        h('ul', {}, r.sources.map((s) => h('li', {},
          h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title || new URL(s.url).hostname)))))
      : null,
  );
}

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

function compareTable(product, listings) {
  const qty = product.qty || 1;
  const totals = listings.map((l) => listingTotal(l, qty));
  const best = {
    total: minOf(totals),
    rating: maxOf(listings.map((l) => l.rating)),
    sold: maxOf(listings.map((l) => l.sold)),
  };
  const multiple = listings.length > 1;

  const cols = listings.map((l, i) => {
    const tags = [];
    if (l.id === product.chosenListingId) tags.push(h('span', { class: 'tag chosen' }, 'Chosen'));
    if (TAGS[l.tag] && !(l.tag === 'PICK' && l.id === product.chosenListingId)) {
      tags.push(h('span', { class: `tag research-tag ${l.tag.toLowerCase()}` }, TAGS[l.tag]));
    }
    if (multiple && totals[i] !== null && totals[i] === best.total) tags.push(h('span', { class: 'tag good' }, 'Cheapest'));
    if (multiple && Number.isFinite(l.rating) && l.rating === best.rating) tags.push(h('span', { class: 'tag' }, 'Top rated'));
    if (multiple && Number.isFinite(l.sold) && l.sold === best.sold && best.sold > 0) tags.push(h('span', { class: 'tag' }, 'Most sold'));
    return { l, total: totals[i], tags };
  });

  const isBest = (on, value, target) => multiple && on && value !== null && Number.isFinite(value) && value === target;

  const rows = [
    ['Price', (c) => (Number.isFinite(c.l.price) ? formatRM(c.l.price) : '–')],
    ['Shipping', (c) => (Number.isFinite(c.l.shipping) ? (c.l.shipping === 0 ? 'Free' : formatRM(c.l.shipping)) : '–')],
    [qty > 1 ? `Total (×${qty})` : 'Total', (c) => h('strong', {}, formatRM(c.total)), (c) => isBest(true, c.total, best.total)],
    ['Rating', (c) => (Number.isFinite(c.l.rating)
      ? `★ ${c.l.rating.toFixed(1)}${Number.isFinite(c.l.ratingCount) ? ` (${formatCount(c.l.ratingCount)})` : ''}` : '–'),
    (c) => isBest(true, c.l.rating, best.rating)],
    ['Sold', (c) => formatCount(c.l.sold), (c) => isBest(best.sold > 0, c.l.sold, best.sold)],
    ['Seller', (c) => h('span', { class: `seller ${c.l.badge || 'none'}` }, BADGES[c.l.badge] || BADGES.none)],
    ['Ships from', (c) => [c.l.shipsFrom || (c.l.overseas ? '' : '–'), c.l.overseas ? h('span', { class: 'tag warn' }, 'Overseas') : null]],
    ['Vouchers', (c) => c.l.voucher || '–'],
    ['Notes', (c) => c.l.notes || '–'],
  ];
  if (listings.some((l) => l.checked)) {
    rows.push(['Price checked', (c) => (c.l.checked === 'card'
      ? h('span', { class: 'muted' }, 'Search page only, not verified')
      : c.l.checked ? formatDate(c.l.checked) : '–')]);
  }

  const table = h('table', { class: 'compare' },
    h('thead', {},
      h('tr', {},
        h('th', { scope: 'col', class: 'label' }, h('span', { class: 'sr-only' }, 'Field')),
        cols.map((c, i) => h('th', { scope: 'col', class: c.l.id === product.chosenListingId ? 'is-chosen' : '' },
          h('div', { class: 'shop' }, c.l.shop || `Listing ${i + 1}`),
          c.tags.length ? h('div', { class: 'tags' }, c.tags) : null,
        )),
      ),
    ),
    h('tbody', {},
      rows.map(([label, cell, best]) => h('tr', {},
        h('th', { scope: 'row', class: 'label' }, label),
        cols.map((c) => h('td', {
          class: [c.l.id === product.chosenListingId ? 'is-chosen' : '', best && best(c) ? 'best' : ''].join(' ').trim() || null,
        }, cell(c))),
      )),
      h('tr', { class: 'actions-row' },
        h('th', { scope: 'row', class: 'label' }, h('span', { class: 'sr-only' }, 'Actions')),
        cols.map((c) => h('td', { class: c.l.id === product.chosenListingId ? 'is-chosen' : null },
          h('div', { class: 'cell-actions' },
            c.l.url ? h('a', { class: 'btn small primary', href: c.l.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open ↗') : null,
            h('button', {
              class: 'btn small', type: 'button',
              onClick: () => save(store.updateProduct(product.id, {
                chosenListingId: product.chosenListingId === c.l.id ? null : c.l.id,
              })),
            }, product.chosenListingId === c.l.id ? 'Unchoose' : 'Choose'),
            h('button', { class: 'btn small ghost', type: 'button', onClick: () => listingDialog(product, c.l) }, 'Edit'),
            h('button', {
              class: 'btn small ghost danger', type: 'button',
              onClick: () => {
                if (!confirm(`Delete listing from ${c.l.shop || 'this seller'}?`)) return;
                save(store.updateProduct(product.id, {
                  listings: (product.listings || []).filter((x) => x.id !== c.l.id),
                  chosenListingId: product.chosenListingId === c.l.id ? null : product.chosenListingId,
                }), 'Listing deleted');
              },
            }, 'Delete'),
          ),
        )),
      ),
    ),
  );
  return h('div', { class: 'table-wrap card' }, table);
}

function minOf(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length ? Math.min(...nums) : null;
}

function maxOf(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : null;
}

// ---------- dialogs ----------

// fields: [{ name, label, type, value, options, placeholder, hint, required, inputmode, maxlength, full }]
// onSubmit(values) returns an error message to keep the dialog open, or nothing to close it.
function formDialog({ title, fields, submitLabel = 'Save', onSubmit }) {
  const errorEl = h('p', { class: 'error-text small', role: 'alert' });
  const inputs = {};

  const fieldEls = fields.map((f) => {
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
    h('button', { class: 'btn ghost small', type: 'button', onClick: close, 'aria-label': 'Close' }, '✕')),
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

      const listing = {
        ...l, // keep research fields such as tag and checked
        id: l.id || newId(),
        url,
        shop: v.shop.trim(),
        price,
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
      // A price typed in by hand counts as checked today.
      if (l.checked && price !== l.price) listing.checked = todayISO();
      // Use the latest copy in case another device changed this item while the form was open.
      const latest = state.products.find((p) => p.id === product.id) || product;
      const current = latest.listings || [];
      const listings = existing ? current.map((x) => (x.id === listing.id ? listing : x)) : [...current, listing];
      save(store.updateProduct(product.id, { listings }), existing ? 'Listing saved' : 'Listing added');
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
    const existing = listId ? state.products.filter((p) => p.listId === listId) : [];
    return { listId, ...planImport(parsed, existing) };
  };

  const refreshPreview = () => {
    if (!parsed) return;
    const { creates, updates } = plan();
    const listingCount = [...creates.map((i) => i.listings.length), ...updates.map((u) => u.added)].reduce((a, b) => a + b, 0);
    const verdicts = parsed.items.reduce((acc, i) => {
      const v = i.research && i.research.verdict;
      if (v) acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {});
    // replaceChildren() would print null as text, so drop empty parts first.
    preview.replaceChildren(...[
      h('p', {},
        h('strong', {}, `${creates.length} new item${creates.length === 1 ? '' : 's'}`),
        updates.length ? `, ${updates.length} existing item${updates.length === 1 ? '' : 's'} updated` : '',
        `, ${listingCount} listing${listingCount === 1 ? '' : 's'}.`),
      Object.keys(verdicts).length
        ? h('p', { class: 'muted small' }, Object.entries(verdicts).map(([v, n]) => `${n} ${VERDICTS[v].toLowerCase()}`).join(' · '))
        : null,
      h('ul', { class: 'import-items' }, parsed.items.slice(0, 12).map((i) => h('li', {},
        i.name,
        i.research && i.research.verdict ? h('span', { class: `verdict-badge ${i.research.verdict}` }, VERDICTS[i.research.verdict]) : null))),
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

  const dialog = h('dialog', { class: 'sheet', 'aria-label': 'Import from Claude' });
  const close = () => dialog.close();
  const form = h('form', {
    novalidate: true,
    onSubmit: (e) => {
      e.preventDefault();
      if (!parsed) return;
      const p = plan();
      if (!p.creates.length && !p.updates.some((u) => u.added || u.patch.research)) {
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
    h('h2', {}, 'Import from Claude'),
    h('button', { class: 'btn ghost small', type: 'button', onClick: close, 'aria-label': 'Close' }, '✕')),
  h('div', { class: 'fields single' },
    h('p', { class: 'muted small' }, 'Ask Claude to research items for your Shopee List, then paste what it gives you. Every item is added with its listings and research.'),
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

store.onUser((user) => {
  if (state.stopWatching) {
    state.stopWatching();
    state.stopWatching = null;
  }
  state.user = user;
  state.lists = [];
  state.products = [];
  state.loaded = false;
  state.dataError = null;
  if (user) {
    state.stopWatching = store.watchAll(
      ({ lists, products }) => {
        state.lists = lists;
        state.products = products;
        state.loaded = true;
        render();
      },
      (err) => {
        console.error(err);
        state.dataError = err;
        render();
      },
    );
  }
  render();
});

render();
