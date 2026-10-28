// Reads research results from Claude and turns them into clean items and listings.
// Accepts the JSON itself, JSON inside a ```json block or other text, or an import link
// (…#import=<base64url JSON>). Everything is validated here; nothing is trusted as-is.

import { parseMoney, parseCount, parseRating, cleanUrl, newId, todayISO } from './util.js';

export const VERDICTS = { buy: 'Worth it', consider: 'Consider', skip: 'Skip' };
export const TAGS = { PICK: 'Pick', ALT: 'Alternative', CHEAPER_BUT: 'Cheaper, but', RELAXED: 'Relaxed' };
export const PRIORITIES = { must: 'Must-have', should: 'Should have', nice: 'Nice to have' };
const MAX_HISTORY = 30;
const BADGE_KEYS = ['none', 'preferred', 'preferredPlus', 'mall'];

const MAX_ITEMS = 50;
const MAX_LISTINGS = 20;

export function decodeImportParam(param) {
  const b64 = param.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  const link = trimmed.match(/#import=([A-Za-z0-9_-]+)/);
  if (link) return decodeImportParam(link[1]);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No import data found. Paste the whole block Claude gave you.');
  return trimmed.slice(start, end + 1);
}

const str = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');

function num(parse, v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parse(v);
  return Number.isFinite(n) ? n : null;
}

function cleanDate(v) {
  const s = str(v, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

// Only https images are shown, so a page can never load a plain-http or script URL.
export function cleanImage(v) {
  const url = cleanUrl(v);
  return url && url.startsWith('https://') ? url.slice(0, 1000) : '';
}

function cleanListing(raw, researchedAt) {
  if (!raw || typeof raw !== 'object') return null;
  const price = num(parseMoney, raw.price);
  if (price === null) return null; // a listing without a price cannot be compared
  const url = cleanUrl(raw.url);
  const tag = str(raw.tag, 20).toUpperCase().replace(/[^A-Z]+/g, '_').replace(/^_|_$/g, '');
  const checked = raw.checked === 'card' ? 'card' : cleanDate(raw.checked);
  return {
    id: newId(),
    url: url || '',
    shop: str(raw.shop, 100),
    price,
    shipping: num(parseMoney, raw.shipping),
    rating: num(parseRating, raw.rating),
    ratingCount: num(parseCount, raw.ratingCount),
    sold: num(parseCount, raw.sold),
    badge: BADGE_KEYS.includes(raw.badge) ? raw.badge : 'none',
    shipsFrom: str(raw.shipsFrom, 60),
    overseas: raw.overseas === true,
    voucher: str(raw.voucher, 500),
    notes: str(raw.notes, 500),
    tag: TAGS[tag] ? tag : '',
    checked,
    image: cleanImage(raw.image),
    history: [{ date: checked && checked !== 'card' ? checked : researchedAt, price }],
  };
}

function cleanList(arr, max, len) {
  return Array.isArray(arr) ? arr.map((s) => str(s, len)).filter(Boolean).slice(0, max) : [];
}

function cleanItem(raw, researchedAt) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name, 120);
  if (!name) return null;
  const qty = Math.min(999, Math.max(1, Math.round(Number(raw.qty) || 1)));
  const listings = (Array.isArray(raw.listings) ? raw.listings : [])
    .map((l) => cleanListing(l, researchedAt)).filter(Boolean).slice(0, MAX_LISTINGS);
  const verdict = VERDICTS[raw.verdict] ? raw.verdict : '';
  const sources = (Array.isArray(raw.sources) ? raw.sources : [])
    .map((s) => ({ title: str(s && s.title, 120), url: cleanUrl(s && s.url) }))
    .filter((s) => s.url)
    .slice(0, 10);
  const research = verdict || raw.summary || listings.length
    ? {
      verdict,
      summary: str(raw.summary, 1500),
      pros: cleanList(raw.pros, 8, 200),
      cons: cleanList(raw.cons, 8, 200),
      sources,
      researchedAt,
    }
    : null;
  const pick = listings.find((l) => l.tag === 'PICK');
  const image = cleanImage(raw.image) || (pick && pick.image) || (listings.find((l) => l.image) || {}).image || '';
  return {
    name,
    qty,
    notes: str(raw.notes, 500),
    image,
    priority: PRIORITIES[raw.priority] ? raw.priority : null,
    listings,
    research,
    chosenListingId: pick ? pick.id : null,
  };
}

// Returns { listName, researchedAt, items } or throws an Error with a readable message.
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(extractJson(text));
  } catch (err) {
    throw new Error(err instanceof SyntaxError ? 'The import data is damaged or incomplete. Copy it again from Claude.' : err.message);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
    throw new Error('This does not look like Shopee List import data.');
  }
  const researchedAt = cleanDate(data.researchedAt) || todayISO();
  const items = data.items.slice(0, MAX_ITEMS).map((it) => cleanItem(it, researchedAt)).filter(Boolean);
  if (!items.length) throw new Error('No items found in the import data.');
  return { listName: str(data.list, 80) || 'Imported', researchedAt, items };
}

// Merge imported items into a list. Items with the same name (ignoring case) are updated:
// listings with a new link are added; a link already saved gets the new price, rating and
// sold count, and a price change is added to its price history. The research is replaced,
// and so is the item photo when the research has a different one.
// A saved listing whose link the new research no longer includes is not deleted: it is
// marked `dropped` (the research date) so the app can show it as "Not in latest research".
// Listings the user added by hand (src 'manual') are never marked. The pick moves to the
// new research pick when the chosen listing was dropped, or when it was the old research
// pick (tag PICK); a listing the user chose themselves is kept.
export function planImport(parsed, existingProducts) {
  const byName = new Map(existingProducts.map((p) => [p.name.trim().toLowerCase(), p]));
  const creates = [];
  const updates = [];
  for (const item of parsed.items) {
    const match = byName.get(item.name.toLowerCase());
    if (!match) {
      creates.push(item);
      continue;
    }
    const incoming = new Map(item.listings.filter((l) => l.url).map((l) => [l.url, l]));
    // Only research that brings listings can say a saved listing was dropped.
    const canDrop = incoming.size > 0;
    let repriced = 0;
    let dropped = 0;
    const kept = (match.listings || []).map((old) => {
      const fresh = old.url && incoming.get(old.url);
      if (fresh) {
        const merged = refreshListing(old, fresh);
        if (merged.price !== old.price) repriced += 1;
        return merged;
      }
      if (canDrop && old.url && old.src !== 'manual' && !old.dropped) {
        dropped += 1;
        return { ...old, dropped: parsed.researchedAt };
      }
      return old;
    });
    const known = new Set(kept.map((l) => l.url).filter(Boolean));
    const added = item.listings.filter((l) => !l.url || !known.has(l.url));
    const all = [...kept, ...added];
    const patch = { listings: all };
    if (item.research) patch.research = item.research;
    if (item.image && item.image !== match.image) patch.image = item.image;
    const before = (match.listings || []).find((l) => l.id === match.chosenListingId);
    const chosen = all.find((l) => l.id === match.chosenListingId);
    // The pick follows the research when nothing usable is chosen, or when the chosen
    // listing was the old research pick. A listing the user picked themselves stays.
    const followsResearch = before && before.tag === 'PICK';
    let pickMoved = false;
    if (!chosen || chosen.dropped || followsResearch) {
      // Follow the research pick: a newly added one, or a saved one with the same link.
      const pick = item.listings.find((l) => l.id === item.chosenListingId);
      const target = pick && (added.includes(pick) ? pick : kept.find((l) => l.url && l.url === pick.url));
      if (target && target.id !== match.chosenListingId) {
        patch.chosenListingId = target.id;
        pickMoved = Boolean(match.chosenListingId);
      }
    }
    updates.push({ id: match.id, name: match.name, added: added.length, repriced, dropped, pickMoved, patch });
  }
  return { creates, updates };
}

// A saved listing seen again in new research: keep its id and the user's own notes,
// take the new facts, and record the price in its history.
function refreshListing(old, fresh) {
  const history = historyOf(old);
  const point = fresh.history[0];
  const last = history[history.length - 1];
  if (!last || last.price !== point.price || last.date !== point.date) history.push(point);
  const keep = (v, fallback) => (v === null || v === undefined || v === '' ? fallback : v);
  return {
    ...old,
    price: fresh.price,
    shipping: keep(fresh.shipping, old.shipping),
    rating: keep(fresh.rating, old.rating),
    ratingCount: keep(fresh.ratingCount, old.ratingCount),
    sold: keep(fresh.sold, old.sold),
    shop: fresh.shop || old.shop,
    badge: fresh.badge !== 'none' ? fresh.badge : old.badge,
    shipsFrom: fresh.shipsFrom || old.shipsFrom,
    voucher: fresh.voucher || old.voucher,
    tag: fresh.tag, // the research decides the tags, so an old Pick tag does not linger
    checked: fresh.checked || old.checked,
    image: fresh.image || old.image || '',
    dropped: null, // back in the research
    history: history.slice(-MAX_HISTORY),
  };
}

// Price history of a listing, oldest first. Listings saved before history existed
// count their current price as the only point.
export function historyOf(listing) {
  if (Array.isArray(listing.history) && listing.history.length) return listing.history.map((p) => ({ ...p }));
  if (!Number.isFinite(listing.price)) return [];
  return [{ date: listing.checked && listing.checked !== 'card' ? listing.checked : '', price: listing.price }];
}
