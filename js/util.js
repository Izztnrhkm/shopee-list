// Small helpers shared by the UI. No Firebase imports here so they stay easy to test.

// Build a DOM element. User text is always set through text nodes, never innerHTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const rm = new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' });

export function formatRM(value) {
  return Number.isFinite(value) ? rm.format(value) : '–';
}

// Parse a money field such as "12.90", "RM12.90" or "1,299". Empty → null.
export function parseMoney(input) {
  if (input === undefined || input === null) return null;
  const text = String(input).replace(/rm/i, '').replace(/,/g, '').trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : NaN;
}

// Parse counts the way Shopee shows them: "856", "1.2k", "10k+", "1,234". Empty → null.
export function parseCount(input) {
  if (input === undefined || input === null) return null;
  const text = String(input).toLowerCase().replace(/,/g, '').replace(/\+/g, '').replace(/sold/g, '').trim();
  if (text === '') return null;
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([km]?)$/);
  if (!match) return NaN;
  const multiplier = { '': 1, k: 1000, m: 1000000 }[match[2]];
  return Math.round(Number(match[1]) * multiplier);
}

export function formatCount(value) {
  if (!Number.isFinite(value)) return '–';
  if (value >= 1000000) return `${trimZero(value / 1000000)}m`;
  if (value >= 1000) return `${trimZero(value / 1000)}k`;
  return String(value);
}

function trimZero(n) {
  return n.toFixed(1).replace(/\.0$/, '');
}

export function parseRating(input) {
  if (input === undefined || input === null || String(input).trim() === '') return null;
  const value = Number(String(input).trim());
  return Number.isFinite(value) && value >= 0 && value <= 5 ? Math.round(value * 10) / 10 : NaN;
}

// Returns a safe http(s) URL string, '' for empty input, or null when invalid.
export function cleanUrl(input) {
  const text = String(input || '').trim();
  if (text === '') return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export function isShopeeMY(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'shopee.com.my' || host.endsWith('.shopee.com.my') || host === 'shp.ee';
  } catch {
    return false;
  }
}

// Price for the whole quantity plus one shipping fee. Null when there is no price.
export function listingTotal(listing, qty = 1) {
  if (!listing || !Number.isFinite(listing.price)) return null;
  const shipping = Number.isFinite(listing.shipping) ? listing.shipping : 0;
  return Math.round((listing.price * Math.max(1, qty) + shipping) * 100) / 100;
}

// The listing a product's estimate is based on: the chosen one, else the cheapest.
export function pickListing(product) {
  const listings = product.listings || [];
  const chosen = listings.find((l) => l.id === product.chosenListingId);
  if (chosen) return chosen;
  let best = null;
  for (const l of listings) {
    const total = listingTotal(l, product.qty);
    if (total === null) continue;
    if (!best || total < listingTotal(best, product.qty)) best = l;
  }
  return best;
}

export function productEstimate(product) {
  return listingTotal(pickListing(product), product.qty);
}

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
