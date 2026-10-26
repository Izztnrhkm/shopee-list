// Security rules tests. From tests/: npm install, then npm run test:rules (needs Java).
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collection, getDocs, Timestamp } from 'firebase/firestore';

let env;
const H = 'h1';
const CODE = 'abcdefghijklmnopqrstuvwx';
const inDays = (d) => Timestamp.fromMillis(Date.now() + d * 86400000);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-shopee-list',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const db = (uid) => env.authenticatedContext(uid).firestore();

async function seedHousehold({ invite = null } = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await setDoc(doc(f, 'households', H), { name: "Izzat's household", ownerUid: 'izzat', createdAt: 1 });
    await setDoc(doc(f, 'households', H, 'members', 'izzat'), { name: 'Izzat', role: 'owner', joinedAt: 1 });
    await setDoc(doc(f, 'households', H, 'lists', 'L1'), { name: 'Kitchen' });
    await setDoc(doc(f, 'households', H, 'products', 'P1'), { listId: 'L1', name: 'Rice cooker' });
    if (invite) await setDoc(doc(f, 'households', H, 'invites', CODE), invite);
  });
}

function joinBatch(f, uid, code = CODE) {
  const b = writeBatch(f);
  b.update(doc(f, 'households', H, 'invites', code), { usedBy: uid, usedAt: 2 });
  b.set(doc(f, 'households', H, 'members', uid), { name: 'Wife', role: 'member', joinedAt: 2, invite: code });
  b.set(doc(f, 'users', uid), { householdId: H });
  return b;
}

test('a person creates their own household with an owner membership', async () => {
  const f = db('izzat');
  const b = writeBatch(f);
  b.set(doc(f, 'households', 'new'), { name: "Izzat's household", ownerUid: 'izzat', createdAt: 1 });
  b.set(doc(f, 'households', 'new', 'members', 'izzat'), { name: 'Izzat', role: 'owner', joinedAt: 1 });
  b.set(doc(f, 'users', 'izzat'), { householdId: 'new' });
  await assertSucceeds(b.commit());
});

test('a household cannot be created for someone else', async () => {
  const f = db('mallory');
  const b = writeBatch(f);
  b.set(doc(f, 'households', 'x'), { name: 'x', ownerUid: 'izzat', createdAt: 1 });
  b.set(doc(f, 'households', 'x', 'members', 'mallory'), { name: 'M', role: 'owner', joinedAt: 1 });
  await assertFails(b.commit());
});

test('members read and write lists; outsiders cannot', async () => {
  await seedHousehold();
  await assertSucceeds(getDoc(doc(db('izzat'), 'households', H, 'lists', 'L1')));
  await assertSucceeds(updateDoc(doc(db('izzat'), 'households', H, 'products', 'P1'), { bought: true }));
  await assertFails(getDoc(doc(db('mallory'), 'households', H, 'lists', 'L1')));
  await assertFails(getDocs(collection(db('mallory'), 'households', H, 'products')));
  await assertFails(setDoc(doc(db('mallory'), 'households', H, 'lists', 'L2'), { name: 'x' }));
  await assertFails(getDoc(doc(db('mallory'), 'households', H)));
});

test('an outsider cannot add themselves as owner or as a member without an invite', async () => {
  await seedHousehold();
  const f = db('mallory');
  await assertFails(setDoc(doc(f, 'households', H, 'members', 'mallory'), { name: 'M', role: 'owner', joinedAt: 1 }));
  await assertFails(setDoc(doc(f, 'households', H, 'members', 'mallory'), { name: 'M', role: 'member', joinedAt: 1, invite: 'nope-nope-nope-nope-nope' }));
});

test('a member creates an invite that lasts at most 7 days', async () => {
  await seedHousehold();
  const f = db('izzat');
  await assertSucceeds(setDoc(doc(f, 'households', H, 'invites', CODE), { createdBy: 'izzat', from: 'Izzat', createdAt: 1, expiresAt: inDays(7), usedBy: null }));
  await assertFails(setDoc(doc(f, 'households', H, 'invites', 'zzzzzzzzzzzzzzzzzzzzzzzz'), { createdBy: 'izzat', from: 'Izzat', createdAt: 1, expiresAt: inDays(30), usedBy: null }));
  await assertFails(setDoc(doc(f, 'households', H, 'invites', 'short'), { createdBy: 'izzat', from: 'Izzat', createdAt: 1, expiresAt: inDays(1), usedBy: null }));
  await assertFails(setDoc(doc(db('mallory'), 'households', H, 'invites', 'yyyyyyyyyyyyyyyyyyyyyyyy'), { createdBy: 'mallory', from: 'M', createdAt: 1, expiresAt: inDays(1), usedBy: null }));
});

test('anyone signed in can look up an invite by its code, but not list invites', async () => {
  await seedHousehold({ invite: { createdBy: 'izzat', from: 'Izzat', createdAt: 1, expiresAt: inDays(7), usedBy: null } });
  await assertSucceeds(getDoc(doc(db('wife'), 'households', H, 'invites', CODE)));
  await assertFails(getDocs(collection(db('wife'), 'households', H, 'invites')));
});

test('a valid invite lets her join once, then she can read the lists', async () => {
  await seedHousehold({ invite: { createdBy: 'izzat', from: 'Izzat', createdAt: 1, expiresAt: inDays(7), usedBy: null } });
  await assertSucceeds(joinBatch(db('wife'), 'wife').commit());
  await assertSucceeds(getDoc(doc(db('wife'), 'households', H, 'lists', 'L1')));
  await assertSucceeds(updateDoc(doc(db('wife'), 'households', H, 'products', 'P1'), { bought: true }));
  // The same code cannot be used again by someone else.
  await assertFails(joinBatch(db('mallory'), 'mallory').commit());
});

test('an expired invite does not work', async () => {
  await seedHousehold({ invite: { createdBy: 'izzat', from: 'Izzat', createdAt: 1, expiresAt: Timestamp.fromMillis(Date.now() - 1000), usedBy: null } });
  await assertFails(joinBatch(db('wife'), 'wife').commit());
});

test('joining must mark the invite used in the same batch', async () => {
  await seedHousehold({ invite: { createdBy: 'izzat', from: 'Izzat', createdAt: 1, expiresAt: inDays(7), usedBy: null } });
  const f = db('wife');
  await assertFails(setDoc(doc(f, 'households', H, 'members', 'wife'), { name: 'Wife', role: 'member', joinedAt: 2, invite: CODE }));
  await assertFails(updateDoc(doc(f, 'households', H, 'invites', CODE), { usedBy: 'wife', usedAt: 2 }));
});

test('a joiner cannot make themself owner', async () => {
  await seedHousehold({ invite: { createdBy: 'izzat', from: 'Izzat', createdAt: 1, expiresAt: inDays(7), usedBy: null } });
  const f = db('wife');
  const b = writeBatch(f);
  b.update(doc(f, 'households', H, 'invites', CODE), { usedBy: 'wife', usedAt: 2 });
  b.set(doc(f, 'households', H, 'members', 'wife'), { name: 'Wife', role: 'owner', joinedAt: 2, invite: CODE });
  await assertFails(b.commit());
});

test('members can leave; the owner can remove others but not leave', async () => {
  await seedHousehold({ invite: { createdBy: 'izzat', from: 'Izzat', createdAt: 1, expiresAt: inDays(7), usedBy: null } });
  await joinBatch(db('wife'), 'wife').commit();
  await assertFails(deleteDoc(doc(db('izzat'), 'households', H, 'members', 'izzat')));
  await assertFails(deleteDoc(doc(db('wife'), 'households', H, 'members', 'izzat')));
  await assertSucceeds(deleteDoc(doc(db('izzat'), 'households', H, 'members', 'wife')));
});

test('people only touch their own user doc and old lists, which are read-only', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', 'izzat', 'lists', 'old'), { name: 'Old' });
  });
  await assertSucceeds(getDoc(doc(db('izzat'), 'users', 'izzat', 'lists', 'old')));
  await assertFails(setDoc(doc(db('izzat'), 'users', 'izzat', 'lists', 'old2'), { name: 'x' }));
  await assertFails(getDoc(doc(db('mallory'), 'users', 'izzat', 'lists', 'old')));
  await assertFails(setDoc(doc(db('mallory'), 'users', 'izzat'), { householdId: 'h1' }));
  await assertSucceeds(setDoc(doc(db('izzat'), 'users', 'izzat'), { householdId: 'h1' }));
});
