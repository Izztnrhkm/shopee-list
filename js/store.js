// Data layer: Firebase Auth (Google sign-in) and Firestore.
//
// Firestore layout. Lists belong to a household that you and the people you invite share:
//   users/{uid}                          { householdId, legacyCopiedAt }
//   households/{hid}                     { name, ownerUid, createdAt }
//   households/{hid}/members/{uid}       { name, role: owner|member, joinedAt, invite? }
//   households/{hid}/invites/{code}      { createdBy, from, createdAt, expiresAt, usedBy, usedAt }
//   households/{hid}/lists/{listId}      { name, createdAt, updatedAt }
//   households/{hid}/products/{id}       { listId, name, qty, bought, boughtBy, boughtAt, notes, image,
//                                    priority (must|should|nice|null), saleDay, research,
//                                    chosenListingId, listings: [... each with history: [{date, price}]],
//                                    createdAt, updatedAt }
// Products sit in one collection so a single listener gives counts and totals for every list.
// Lists made before households existed stay under users/{uid}/lists and users/{uid}/products;
// they are copied (not moved) into your household the first time you sign in after the update.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
// The Google sign-in helper (an iframe plus about 130 KB) is only needed when someone signs in,
// so it is passed to the sign-in calls instead of loading on every visit.
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
const REDIRECT_FLAG = 'shopee-list-redirect';
try {
  if (sessionStorage.getItem(REDIRECT_FLAG)) {
    sessionStorage.removeItem(REDIRECT_FLAG);
    getRedirectResult(auth, browserPopupRedirectResolver).catch((err) => console.warn('Redirect sign-in failed', err));
  }
} catch {
  // sessionStorage can be blocked; the redirect result is then picked up by onAuthStateChanged anyway.
}

// Local cache keeps the list readable and editable offline; changes sync when back online.
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (err) {
  console.warn('Offline cache unavailable, using memory only', err);
  db = initializeFirestore(app, {});
}

let uid = null;
let hid = null;

export function onUser(callback) {
  return onAuthStateChanged(auth, (user) => {
    uid = user ? user.uid : null;
    callback(user);
  });
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider, browserPopupRedirectResolver);
  } catch (err) {
    if (err && err.code === 'auth/popup-blocked') {
      try { sessionStorage.setItem(REDIRECT_FLAG, '1'); } catch { /* ignore */ }
      await signInWithRedirect(auth, provider, browserPopupRedirectResolver);
      return;
    }
    throw err;
  }
}

export function signOut() {
  return fbSignOut(auth);
}

function userCol(name) {
  if (!uid || !hid) throw new Error('Not signed in');
  return collection(db, 'households', hid, name);
}

function userDoc(name, id) {
  if (!uid || !hid) throw new Error('Not signed in');
  return doc(db, 'households', hid, name, id);
}

// ---------- households ----------

const DAY = 86400000;

function displayName(user) {
  return String((user && (user.displayName || user.email)) || 'Me').slice(0, 60);
}

export function householdId() {
  return hid;
}

// Finds the household this person uses. Creates one (and copies their older lists into it)
// unless `deferCreate` is set, in which case it returns null so they can join one instead.
export async function openHousehold(user, { deferCreate = false } = {}) {
  hid = null;
  const userRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userRef);
  const data = snap.exists() ? snap.data() : {};
  if (data.householdId) {
    // Offline with nothing cached, the check throws: trust the saved household rather than
    // making a new one. Only a definite "not a member" (removed) starts a fresh household.
    const member = await getDoc(doc(db, 'households', data.householdId, 'members', user.uid)).catch(() => 'unknown');
    if (member === 'unknown' || member.exists()) {
      hid = data.householdId;
      if (!data.legacyCopiedAt) await copyLegacy(user.uid, hid);
      return hid;
    }
  }
  if (deferCreate) return null;
  return createHousehold(user);
}

export async function createHousehold(user) {
  const ref = doc(collection(db, 'households'));
  const first = displayName(user).split(' ')[0];
  const batch = writeBatch(db);
  batch.set(ref, { name: `${first}'s household`, ownerUid: user.uid, createdAt: Date.now() });
  batch.set(doc(db, 'households', ref.id, 'members', user.uid), { name: displayName(user), role: 'owner', joinedAt: Date.now() });
  batch.set(doc(db, 'users', user.uid), { householdId: ref.id }, { merge: true });
  await batch.commit();
  hid = ref.id;
  await copyLegacy(user.uid, hid);
  return hid;
}

// Copy lists and products from one place to another, keeping ids so a second run changes nothing.
async function copyAll(fromPath, toHid) {
  const lists = await getDocs(collection(db, ...fromPath, 'lists'));
  const products = await getDocs(collection(db, ...fromPath, 'products'));
  const docs = [
    ...lists.docs.map((d) => [doc(db, 'households', toHid, 'lists', d.id), d.data()]),
    ...products.docs.map((d) => [doc(db, 'households', toHid, 'products', d.id), d.data()]),
  ];
  for (let i = 0; i < docs.length; i += 450) {
    const batch = writeBatch(db);
    docs.slice(i, i + 450).forEach(([ref, value]) => batch.set(ref, value, { merge: true }));
    await batch.commit();
  }
  return lists.size;
}

// Lists made before households: copied once, the originals left untouched as a backup.
async function copyLegacy(userId, toHid) {
  const copied = await copyAll(['users', userId], toHid);
  await setDoc(doc(db, 'users', userId), { legacyCopiedAt: Date.now() }, { merge: true });
  return copied;
}

export function watchHousehold(onData, onError) {
  if (!hid) throw new Error('No household');
  let household = null;
  let members = null;
  const emit = () => { if (household && members) onData({ household, members }); };
  const stopH = onSnapshot(doc(db, 'households', hid), (s) => { household = { id: s.id, ...s.data() }; emit(); }, onError);
  const stopM = onSnapshot(collection(db, 'households', hid, 'members'), (s) => {
    members = s.docs.map((d) => ({ uid: d.id, ...d.data() }));
    emit();
  }, onError);
  return () => { stopH(); stopM(); };
}

function randomCode(length = 24) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

// Returns the invite link. It works once and expires after 7 days.
export async function createInvite(user) {
  const code = randomCode();
  const now = Date.now();
  await setDoc(doc(db, 'households', hid, 'invites', code), {
    createdBy: user.uid,
    from: displayName(user),
    createdAt: now,
    expiresAt: Timestamp.fromMillis(now + 7 * DAY - 60000),
    usedBy: null,
  });
  const base = `${location.origin}${location.pathname}`;
  return `${base}#join=${hid}.${code}`;
}

// { from, expired, used } or null when the code does not exist.
export async function lookupInvite(targetHid, code) {
  const snap = await getDoc(doc(db, 'households', targetHid, 'invites', code));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    from: d.from || 'Someone',
    used: !!d.usedBy,
    usedByMe: d.usedBy === uid,
    expired: d.expiresAt && d.expiresAt.toMillis() < Date.now(),
  };
}

// Join with an invite. Your own lists (older ones, and any in a household where you were
// the only member) are copied into the household you join, so nothing is left behind.
export async function joinHousehold(user, targetHid, code) {
  const userSnap = await getDoc(doc(db, 'users', user.uid));
  const before = userSnap.exists() ? userSnap.data() : {};
  const batch = writeBatch(db);
  batch.update(doc(db, 'households', targetHid, 'invites', code), { usedBy: user.uid, usedAt: Date.now() });
  batch.set(doc(db, 'households', targetHid, 'members', user.uid), { name: displayName(user), role: 'member', joinedAt: Date.now(), invite: code });
  batch.set(doc(db, 'users', user.uid), { householdId: targetHid }, { merge: true });
  await batch.commit();

  if (!before.legacyCopiedAt) await copyLegacy(user.uid, targetHid);
  const old = before.householdId;
  if (old && old !== targetHid) {
    try {
      const others = (await getDocs(collection(db, 'households', old, 'members'))).docs.filter((d) => d.id !== user.uid);
      if (!others.length) await copyAll(['households', old], targetHid);
    } catch (err) {
      console.warn('Could not copy lists from the previous household', err);
    }
  }
  hid = targetHid;
  return hid;
}

export function removeMember(memberUid) {
  return deleteDoc(doc(db, 'households', hid, 'members', memberUid));
}

export function renameHousehold(name) {
  return updateDoc(doc(db, 'households', hid), { name });
}

function docsOf(snapshot) {
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Calls onData({ lists, products }) on every change. Returns an unsubscribe function.
export function watchAll(onData, onError) {
  let lists = null;
  let products = null;
  const emit = () => {
    if (lists && products) onData({ lists, products });
  };
  const stopLists = onSnapshot(userCol('lists'), (snap) => { lists = docsOf(snap); emit(); }, onError);
  const stopProducts = onSnapshot(userCol('products'), (snap) => { products = docsOf(snap); emit(); }, onError);
  return () => { stopLists(); stopProducts(); };
}

// Writes resolve once the server confirms, which never happens offline, so callers
// should not await them before updating the screen. The snapshot listener does that.

export function addList(name) {
  const now = Date.now();
  return addDoc(userCol('lists'), { name, createdAt: now, updatedAt: now });
}

export function renameList(id, name) {
  return updateDoc(userDoc('lists', id), { name, updatedAt: Date.now() });
}

export function deleteList(id, productIds) {
  // A batch holds at most 500 writes, so split large lists. The list itself goes in the last batch.
  const ids = [...productIds];
  const commits = [];
  do {
    const batch = writeBatch(db);
    for (const pid of ids.splice(0, 450)) batch.delete(userDoc('products', pid));
    if (ids.length === 0) batch.delete(userDoc('lists', id));
    commits.push(batch.commit());
  } while (ids.length);
  return Promise.all(commits);
}

export function addProduct(listId, { name, qty }) {
  const now = Date.now();
  return addDoc(userCol('products'), {
    listId,
    name,
    qty,
    bought: false,
    notes: '',
    chosenListingId: null,
    listings: [],
    createdAt: now,
    updatedAt: now,
  });
}

export function updateProduct(id, patch) {
  return updateDoc(userDoc('products', id), { ...patch, updatedAt: Date.now() });
}

export function deleteProduct(id) {
  return deleteDoc(userDoc('products', id));
}

// Apply an import plan in batches. Creates the list when listId is null.
// Returns { listId, done } right away so the screen can move on while it syncs.
export function importItems(listId, listName, { creates, updates }) {
  const now = Date.now();
  const ops = [];
  let target = listId;
  if (!target) {
    const ref = doc(userCol('lists'));
    target = ref.id;
    ops.push((b) => b.set(ref, { name: listName, createdAt: now, updatedAt: now }));
  }
  creates.forEach((item, i) => {
    const ref = doc(userCol('products'));
    ops.push((b) => b.set(ref, {
      listId: target,
      name: item.name,
      qty: item.qty,
      bought: false,
      notes: item.notes,
      image: item.image || '',
      priority: item.priority || null,
      saleDay: false,
      chosenListingId: item.chosenListingId,
      listings: item.listings,
      research: item.research,
      createdAt: now + i,
      updatedAt: now,
    }));
  });
  for (const u of updates) ops.push((b) => b.update(userDoc('products', u.id), { ...u.patch, updatedAt: now }));

  const commits = [];
  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db);
    ops.slice(i, i + 450).forEach((op) => op(batch));
    commits.push(batch.commit());
  }
  return { listId: target, done: Promise.all(commits) };
}
