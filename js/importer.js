// Reads research results from Claude and turns them into clean items and listings.
// Accepts the JSON itself, JSON inside a ```json block or other text, or an import link
// (…#import=<base64url JSON>). Everything is validated here; nothing is trusted as-is.

import { parseMoney, parseCount, parseRating, cleanUrl, newId, todayISO } from './util.js';

export const VERDICTS = { buy: 'Worth it', consider: 'Consider', skip: 'Skip' };
export const TAGS = { PICK: 'Pick', ALT: 'Alternative', CHEAPER_BUT: 'Cheaper, but', RELAXED: 'Relaxed' };
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

function cleanListing(raw) {
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
  const listings = (Array.isArray(raw.listings) ? raw.listings : []).map(cleanListing).filter(Boolean).slice(0, MAX_LISTINGS);
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
  return { name, qty, notes: str(raw.notes, 500), listings, research, chosenListingId: pick ? pick.id : null };
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
// new listings are added (skipping links already saved) and the research replaces the old one.
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
    const known = new Set((match.listings || []).map((l) => l.url).filter(Boolean));
    const fresh = item.listings.filter((l) => !l.url || !known.has(l.url));
    const patch = { listings: [...(match.listings || []), ...fresh] };
    if (item.research) patch.research = item.research;
    if (!match.chosenListingId && item.chosenListingId && fresh.some((l) => l.id === item.chosenListingId)) {
      patch.chosenListingId = item.chosenListingId;
    }
    updates.push({ id: match.id, name: match.name, added: fresh.length, patch });
  }
  return { creates, updates };
}
