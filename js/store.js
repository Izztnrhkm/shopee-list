// Data layer: Firebase Auth (Google sign-in) and Firestore.
//
// Firestore layout, all private to the signed-in user:
//   users/{uid}/lists/{listId}     { name, createdAt, updatedAt }
//   users/{uid}/products/{id}      { listId, name, qty, bought, notes,
//                                    chosenListingId, listings: [...], createdAt, updatedAt }
// Products sit in one collection so a single listener gives counts and totals for every list.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
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
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

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
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err && err.code === 'auth/popup-blocked') {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

export function signOut() {
  return fbSignOut(auth);
}

function userCol(name) {
  if (!uid) throw new Error('Not signed in');
  return collection(db, 'users', uid, name);
}

function userDoc(name, id) {
  if (!uid) throw new Error('Not signed in');
  return doc(db, 'users', uid, name, id);
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
