// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImport, planImport, historyOf } from '../js/importer.js';
import { nextSale, priorityOf, firstSentence, ageText, daysBetween } from '../js/util.js';

const block = (items, extra = {}) => JSON.stringify({ shopeeList: 1, list: 'Kitchen', researchedAt: '2026-10-26', items, ...extra });
const listing = (over = {}) => ({ url: 'https://shopee.com.my/product/1/2', shop: 'A', price: 294, tag: 'PICK', checked: 'card', ...over });

test('images: only https links are kept', () => {
  const p = parseImport(block([
    { name: 'A', image: 'https://down-my.img.susercontent.com/file/abc', listings: [listing()] },
    { name: 'B', image: 'http://example.com/x.jpg', listings: [listing({ image: 'javascript:alert(1)' })] },
  ]));
  assert.equal(p.items[0].image, 'https://down-my.img.susercontent.com/file/abc');
  assert.equal(p.items[1].image, '');
  assert.equal(p.items[1].listings[0].image, '');
});

test('item image falls back to the pick listing image', () => {
  const p = parseImport(block([{ name: 'A', listings: [listing({ image: 'https://cdn.example/a.jpg' })] }]));
  assert.equal(p.items[0].image, 'https://cdn.example/a.jpg');
});

test('history starts with the research-day price', () => {
  const p = parseImport(block([{ name: 'A', listings: [listing(), listing({ url: 'https://shopee.com.my/product/1/3', price: 299, tag: 'ALT', checked: '2026-10-25' })] }]));
  assert.deepEqual(p.items[0].listings[0].history, [{ date: '2026-10-26', price: 294 }]);
  assert.deepEqual(p.items[0].listings[1].history, [{ date: '2026-10-25', price: 299 }]);
});

test('priority is read from the import when valid', () => {
  const p = parseImport(block([{ name: 'A', priority: 'must', listings: [listing()] }, { name: 'B', priority: 'urgent', listings: [listing()] }]));
  assert.equal(p.items[0].priority, 'must');
  assert.equal(p.items[1].priority, null);
});

test('re-import of a saved link updates the price and adds history', () => {
  const first = parseImport(block([{ name: 'Rice cooker', listings: [listing()] }]));
  const saved = { id: 'p1', name: 'Rice cooker', listings: first.items[0].listings, chosenListingId: first.items[0].chosenListingId };
  const again = parseImport(block([{ name: 'Rice cooker', listings: [listing({ price: 279, checked: '2026-11-10' })] }], { researchedAt: '2026-11-10' }));
  const plan = planImport(again, [saved]);
  assert.equal(plan.creates.length, 0);
  const u = plan.updates[0];
  assert.equal(u.added, 0);
  assert.equal(u.repriced, 1);
  const l = u.patch.listings[0];
  assert.equal(l.id, saved.listings[0].id, 'keeps the listing id so the pick stays');
  assert.equal(l.price, 279);
  assert.equal(l.checked, '2026-11-10');
  assert.deepEqual(l.history, [{ date: '2026-10-26', price: 294 }, { date: '2026-11-10', price: 279 }]);
});

test('re-import with the same price and date adds nothing', () => {
  const first = parseImport(block([{ name: 'Rice cooker', listings: [listing()] }]));
  const saved = { id: 'p1', name: 'Rice cooker', listings: first.items[0].listings };
  const plan = planImport(parseImport(block([{ name: 'Rice cooker', listings: [listing()] }])), [saved]);
  assert.equal(plan.updates[0].repriced, 0);
  assert.equal(plan.updates[0].patch.listings[0].history.length, 1);
});

test('listings saved before history existed count their price as one point', () => {
  assert.deepEqual(historyOf({ price: 10, checked: '2026-10-01' }), [{ date: '2026-10-01', price: 10 }]);
  assert.deepEqual(historyOf({ price: 10, checked: 'card' }), [{ date: '', price: 10 }]);
  assert.deepEqual(historyOf({}), []);
});

test('new links are added next to saved ones', () => {
  const first = parseImport(block([{ name: 'A', listings: [listing()] }]));
  const saved = { id: 'p1', name: 'A', listings: first.items[0].listings };
  const plan = planImport(parseImport(block([{ name: 'A', listings: [listing(), listing({ url: 'https://shopee.com.my/product/9/9', price: 300, tag: 'ALT' })] }])), [saved]);
  assert.equal(plan.updates[0].added, 1);
  assert.equal(plan.updates[0].patch.listings.length, 2);
});

test('next double-day sale', () => {
  assert.deepEqual(nextSale(new Date(2026, 9, 26)), { label: '11.11', date: '2026-11-11', days: 16 });
  assert.equal(nextSale(new Date(2026, 10, 11)).days, 0);
  assert.equal(nextSale(new Date(2026, 10, 12)).label, '12.12');
  assert.deepEqual(nextSale(new Date(2026, 11, 13)), { label: '1.1', date: '2027-01-01', days: 19 });
});

test('priority defaults from the verdict', () => {
  assert.equal(priorityOf({ research: { verdict: 'consider' } }), 'nice');
  assert.equal(priorityOf({ research: { verdict: 'buy' } }), 'should');
  assert.equal(priorityOf({ priority: 'must', research: { verdict: 'consider' } }), 'must');
  assert.equal(priorityOf({}), 'should');
});

test('small text helpers', () => {
  assert.equal(firstSentence('Current 1.8 L model. Old pick archived.'), 'Current 1.8 L model.');
  assert.equal(ageText('2026-10-20', '2026-10-26'), '6 days ago');
  assert.equal(ageText('card', '2026-10-26'), '');
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
});

test('re-import replaces the item photo when the research has a new one', () => {
  const first = parseImport(block([{ name: 'Poncho', image: 'https://cdn.example/women.jpg', listings: [listing()] }]));
  const saved = { id: 'p1', name: 'Poncho', image: first.items[0].image, listings: first.items[0].listings, chosenListingId: first.items[0].chosenListingId };
  const again = parseImport(block([{ name: 'Poncho', image: 'https://cdn.example/men.jpg', listings: [listing()] }]));
  const { updates } = planImport(again, [saved]);
  assert.equal(updates[0].patch.image, 'https://cdn.example/men.jpg');
  const same = planImport(parseImport(block([{ name: 'Poncho', image: 'https://cdn.example/women.jpg', listings: [listing()] }])), [saved]);
  assert.equal(same.updates[0].patch.image, undefined);
});

test('a saved listing the new research dropped is marked, not deleted, and the pick follows the research', () => {
  const wrong = 'https://shopee.com.my/product/9/9';
  const first = parseImport(block([{ name: 'Poncho', listings: [listing({ url: wrong })] }]));
  const manual = { id: 'm1', url: 'https://example.com/mine', shop: 'Mine', price: 50, src: 'manual' };
  const saved = { id: 'p1', name: 'Poncho', listings: [...first.items[0].listings, manual], chosenListingId: first.items[0].chosenListingId };
  const right = 'https://www.decathlon.my/p/poncho.html';
  const again = parseImport(block([{ name: 'Poncho', listings: [listing({ url: right, price: 99 })] }], { researchedAt: '2026-10-28' }));
  const u = planImport(again, [saved]).updates[0];
  assert.equal(u.dropped, 1);
  const byUrl = Object.fromEntries(u.patch.listings.map((l) => [l.url, l]));
  assert.equal(byUrl[wrong].dropped, '2026-10-28');
  assert.equal(byUrl[manual.url].dropped, undefined); // hand-added listings are never marked
  assert.equal(u.patch.chosenListingId, byUrl[right].id);
});

test('a dropped listing that comes back in research is unmarked', () => {
  const url = 'https://shopee.com.my/product/1/2';
  const saved = { id: 'p1', name: 'A', listings: [{ id: 'l1', url, price: 10, dropped: '2026-10-28', history: [{ date: '2026-10-26', price: 10 }] }], chosenListingId: 'l1' };
  const u = planImport(parseImport(block([{ name: 'A', listings: [listing({ url, price: 10 })] }])), [saved]).updates[0];
  assert.equal(u.patch.listings[0].dropped, null);
  assert.equal(u.dropped, 0);
});

test('research without listings never marks saved listings', () => {
  const saved = { id: 'p1', name: 'A', listings: [{ id: 'l1', url: 'https://shopee.com.my/product/1/2', price: 10 }], chosenListingId: 'l1' };
  const u = planImport(parseImport(block([{ name: 'A', verdict: 'skip', summary: 'Not worth it.', listings: [] }])), [saved]).updates[0];
  assert.equal(u.dropped, 0);
  assert.equal(u.patch.listings[0].dropped, undefined);
});

test('re-import moves the pick when the old pick was the research pick', () => {
  const a = 'https://shopee.com.my/product/1/2';
  const b = 'https://shopee.com.my/product/3/4';
  const first = parseImport(block([{ name: 'A', listings: [listing({ url: a }), listing({ url: b, price: 250, tag: 'ALT' })] }]));
  const saved = { id: 'p1', name: 'A', listings: first.items[0].listings, chosenListingId: first.items[0].chosenListingId };
  const again = parseImport(block([{ name: 'A', listings: [listing({ url: a, tag: 'CHEAPER_BUT' }), listing({ url: b, price: 250, tag: 'PICK' })] }]));
  const u = planImport(again, [saved]).updates[0];
  const byUrl = Object.fromEntries(u.patch.listings.map((l) => [l.url, l]));
  assert.equal(u.patch.chosenListingId, byUrl[b].id);
  assert.equal(u.pickMoved, true);
  assert.equal(byUrl[a].tag, 'CHEAPER_BUT');
});

test('re-import keeps a pick the user chose themselves', () => {
  const a = 'https://shopee.com.my/product/1/2';
  const b = 'https://shopee.com.my/product/3/4';
  const c = 'https://shopee.com.my/product/5/6';
  const first = parseImport(block([{ name: 'A', listings: [listing({ url: a }), listing({ url: b, price: 250, tag: 'ALT' }), listing({ url: c, price: 200, tag: '' })] }]));
  const own = first.items[0].listings[2];
  const saved = { id: 'p1', name: 'A', listings: first.items[0].listings, chosenListingId: own.id };
  const again = parseImport(block([{ name: 'A', listings: [listing({ url: a, tag: 'ALT' }), listing({ url: b, price: 250, tag: 'PICK' }), listing({ url: c, price: 200, tag: '' })] }]));
  const u = planImport(again, [saved]).updates[0];
  assert.equal(u.patch.chosenListingId, undefined);
  assert.equal(u.pickMoved, false);
});

test('a listing no longer tagged in the research loses its old tag', () => {
  const first = parseImport(block([{ name: 'A', listings: [listing()] }]));
  const saved = { id: 'p1', name: 'A', listings: first.items[0].listings, chosenListingId: first.items[0].chosenListingId };
  const u = planImport(parseImport(block([{ name: 'A', listings: [listing({ tag: '' }), listing({ url: 'https://shopee.com.my/product/7/8', tag: 'PICK' })] }])), [saved]).updates[0];
  assert.equal(u.patch.listings[0].tag, '');
});

test('re-importing research with link-less listings replaces them instead of adding copies', () => {
  const research = block([{ name: 'Tape measure', listings: [listing({ url: '', shop: 'Stanley', price: 25 }), listing({ price: 30, tag: 'ALT' })] }]);
  const first = parseImport(research);
  let saved = { id: 'p1', name: 'Tape measure', listings: first.items[0].listings, chosenListingId: first.items[0].chosenListingId };
  for (let round = 0; round < 3; round++) {
    const u = planImport(parseImport(research), [saved]).updates[0];
    saved = { ...saved, ...u.patch };
  }
  assert.equal(saved.listings.length, 2);
  assert.equal(saved.listings.filter((l) => l.tag === 'PICK').length, 1);
  const chosen = saved.listings.find((l) => l.id === saved.chosenListingId);
  assert.equal(chosen.tag, 'PICK');
  assert.equal(chosen.url, '');
});

test('re-import clears link-less duplicates saved by earlier imports', () => {
  const dupes = [1, 2, 3].map((n) => ({ id: `l${n}`, url: '', shop: 'Stanley', price: 25, tag: 'PICK' }));
  const saved = { id: 'p1', name: 'A', listings: dupes, chosenListingId: 'l3' };
  const u = planImport(parseImport(block([{ name: 'A', listings: [listing({ url: '', shop: 'Stanley', price: 24 })] }])), [saved]).updates[0];
  assert.equal(u.patch.listings.length, 1);
  assert.equal(u.patch.chosenListingId, u.patch.listings[0].id);
});

test('re-import keeps link-less listings added by hand, and research without listings keeps all', () => {
  const own = { id: 'm1', url: '', shop: 'Pasar malam', price: 10, src: 'manual' };
  const research = { id: 'r1', url: '', shop: 'Stanley', price: 25, tag: 'PICK' };
  const saved = { id: 'p1', name: 'A', listings: [own, research], chosenListingId: 'r1' };
  const withListings = planImport(parseImport(block([{ name: 'A', listings: [listing()] }])), [saved]).updates[0];
  assert.deepEqual(withListings.patch.listings.map((l) => l.id).slice(0, 1), ['m1']);
  assert.equal(withListings.patch.listings.some((l) => l.id === 'r1'), false);
  const noListings = planImport(parseImport(block([{ name: 'A', verdict: 'skip', summary: 'Not worth it.', listings: [] }])), [saved]).updates[0];
  assert.deepEqual(noListings.patch.listings.map((l) => l.id), ['m1', 'r1']);
});

test('a link-less listing the user chose stays chosen through re-import by its shop', () => {
  const items = [listing(), listing({ url: '', shop: 'Kedai Ali', price: 20, tag: 'CHEAPER_BUT' })];
  const first = parseImport(block([{ name: 'A', listings: items }]));
  const mine = first.items[0].listings[1];
  const saved = { id: 'p1', name: 'A', listings: first.items[0].listings, chosenListingId: mine.id };
  const u = planImport(parseImport(block([{ name: 'A', listings: items }])), [saved]).updates[0];
  const chosen = u.patch.listings.find((l) => l.id === u.patch.chosenListingId);
  assert.equal(chosen.shop, 'Kedai Ali');
  assert.equal(u.pickMoved, false);
  assert.equal(u.patch.listings.length, 2);
});
