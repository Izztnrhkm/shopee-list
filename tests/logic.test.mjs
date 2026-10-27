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
