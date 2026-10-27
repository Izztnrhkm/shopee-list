const { chromium } = require('playwright');
const fs = require('fs');
// Household end-to-end test: the real app against the Auth and Firestore emulators.
// From tests/: npm install, serve the repo root on port 8765 (python3 -m http.server 8765),
// then npm run test:e2e. Screenshots land in tests/.
const path = require('path');
const REPO = path.resolve(__dirname, '..') + '/';
const PROJECT = 'shopee-list-dea0e';
const log = (...a) => console.log('E2E', ...a);
let fails = 0;
const check = (cond, msg) => { log(cond ? 'PASS' : 'FAIL', msg); if (!cond) fails++; };

function patchedStore() {
  let s = fs.readFileSync(REPO + 'js/store.js', 'utf8');
  s = s.replace("  signOut as fbSignOut,\n}", "  signOut as fbSignOut,\n  connectAuthEmulator,\n  signInWithCredential,\n}");
  s = s.replace("  Timestamp,\n}", "  Timestamp,\n  connectFirestoreEmulator,\n}");
  s = s.replace(/const auth = initializeAuth\([^;]*\);/, (m) => `${m}\nconnectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });`);
  s = s.replace(/let db;\ntry \{[\s\S]*?\n\}\n/, "let db = initializeFirestore(app, {});\nconnectFirestoreEmulator(db, '127.0.0.1', 8080);\n");
  s = s.replace(/export async function signIn\(\) \{[\s\S]*?\n\}\n/, "export async function signIn() {\n  await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify(window.__testUser)));\n}\n");
  if (!s.includes('connectFirestoreEmulator(db') || !s.includes('connectAuthEmulator(auth')) throw new Error('patch failed');
  return s;
}

async function signInIdp(user) {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestUri: 'http://localhost', returnSecureToken: true, postBody: `id_token=${encodeURIComponent(JSON.stringify(user))}&providerId=google.com` }),
  });
  const j = await r.json();
  return j.localId;
}

async function seedLegacy(uid) {
  const base = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
  const put = (path, fields) => fetch(`${base}/${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields }) });
  await put(`users/${uid}/lists/oldKitchen`, { name: { stringValue: 'Kitchen' }, createdAt: { integerValue: '1' }, updatedAt: { integerValue: '1' } });
  await put(`users/${uid}/products/oldRice`, { listId: { stringValue: 'oldKitchen' }, name: { stringValue: 'Rice cooker 1.8 L (Panasonic SR-DA182)' }, qty: { integerValue: '1' }, bought: { booleanValue: false }, listings: { arrayValue: { values: [] } }, createdAt: { integerValue: '1' } });
  await put(`users/${uid}/products/oldKnife`, { listId: { stringValue: 'oldKitchen' }, name: { stringValue: 'Chef knife' }, qty: { integerValue: '1' }, bought: { booleanValue: false }, listings: { arrayValue: { values: [] } }, createdAt: { integerValue: '2' } });
}

async function countDocs(path) {
  const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${path}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  const j = await r.json();
  return (j.documents || []).length;
}
async function getDocJ(path) {
  const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { Authorization: 'Bearer owner' } });
  return r.json();
}

const USERS = {
  izzat: { sub: 'g-izzat', email: 'izzat@example.com', email_verified: true, name: 'Izzat Nur' },
  wife: { sub: 'g-wife', email: 'wife@example.com', email_verified: true, name: 'Aisyah' },
  mallory: { sub: 'g-mal', email: 'mal@example.com', email_verified: true, name: 'Mallory' },
};

async function context(b, who) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const store = patchedStore();
  await ctx.route('**/js/store.js', (r) => r.fulfill({ contentType: 'text/javascript', body: store }));
  await ctx.addInitScript((u) => {
    window.__testUser = u;
    window.__copied = [];
    try { delete Navigator.prototype.share; } catch (e) {}
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true });
    window.confirm = () => true;
  }, USERS[who]);
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', (e) => page.errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errs.push(m.text()); });
  return page;
}

(async () => {
  const izzatUid = await signInIdp(USERS.izzat);
  await seedLegacy(izzatUid);
  log('izzat uid', izzatUid);
  const b = await chromium.launch();

  // 1. Izzat signs in: household created, old lists copied, originals kept.
  const A = await context(b, 'izzat');
  await A.goto('http://localhost:8765/');
  await A.click('text=Sign in with Google');
  await A.waitForSelector('.list-card', { timeout: 15000 });
  check((await A.locator('.list-card .name').allTextContents()).includes('Kitchen'), 'old Kitchen list shows after the update');
  const userDoc = await getDocJ(`users/${izzatUid}`);
  const hid = userDoc.fields && userDoc.fields.householdId && userDoc.fields.householdId.stringValue;
  check(!!hid, 'users doc points to a household');
  check(await countDocs(`households/${hid}/products`) === 2, 'both old products copied');
  check(await countDocs(`users/${izzatUid}/products`) === 2, 'old products left in place as a backup');

  // Reload: no duplicates.
  await A.reload(); await A.waitForSelector('.list-card', { timeout: 15000 });
  check(await A.locator('.list-card').count() === 1 && await countDocs(`households/${hid}/lists`) === 1, 'reload makes no duplicate lists');

  // 2. Invite.
  await A.goto('http://localhost:8765/#/household'); await A.waitForSelector('text=Share invite link');
  await A.click('text=Share invite link'); await A.waitForTimeout(1500);
  const link = (await A.evaluate(() => window.__copied))[0] || '';
  check(/#join=[A-Za-z0-9]+\.[a-z0-9]{24}$/.test(link), 'invite link created');
  log('link', link.replace(/\.[a-z0-9]{24}$/, '.<code>'));
  await A.screenshot({ path: __dirname + '/e2e-household-izzat.png' });

  // 3. Wife opens the link, signs in, joins.
  const W = await context(b, 'wife');
  await W.goto(link.replace(/^https?:\/\/[^/]+\/[^#]*/, 'http://localhost:8765/'));
  await W.click('text=Sign in with Google');
  await W.waitForSelector('dialog[open]', { timeout: 15000 });
  const title = await W.locator('dialog[open] h2').textContent();
  check(/Join Izzat Nur's household\?/.test(title), `join prompt: "${title}"`);
  await W.click('dialog[open] .sheet-foot button.primary');
  await W.waitForSelector('.list-card', { timeout: 15000 }).catch(async () => {
    await W.screenshot({ path: __dirname + '/e2e-wife-fail.png' });
    log('wife errs', JSON.stringify(W.errs), 'toast', await W.locator('#toast').textContent(), 'main', (await W.locator('main').textContent()).slice(0, 200));
  });
  check((await W.locator('.list-card .name').allTextContents()).includes('Kitchen'), 'wife sees the shared Kitchen list');

  // 4. Wife ticks the rice cooker; Izzat sees it, with her name.
  await W.goto(`http://localhost:8765/#/l/oldKitchen`); await W.waitForSelector('li.item');
  await W.click('button[aria-label^="Mark bought: Rice cooker"]');
  await A.goto(`http://localhost:8765/#/l/oldKitchen`);
  await A.waitForSelector('text=Bought by Aisyah', { timeout: 10000 }).catch(() => {});
  await A.click('text=Bought 1').catch(() => {});
  await A.waitForTimeout(500);
  check(await A.locator('text=Bought by Aisyah').count() >= 1, 'Izzat sees "Bought by Aisyah"');
  await A.goto('http://localhost:8765/#/household'); await A.waitForTimeout(1200);
  check((await A.locator('.plan-row .name').allTextContents()).some((t) => t.startsWith('Aisyah')), 'household lists Aisyah as a member');
  check(await A.locator('text=by Aisyah').count() >= 1, 'recently bought shows Aisyah');
  await A.screenshot({ path: __dirname + '/e2e-household-after.png' });

  // 5. Mallory tries the same link: refused, and cannot read the lists.
  const M = await context(b, 'mallory');
  await M.goto(link.replace(/^https?:\/\/[^/]+\/[^#]*/, 'http://localhost:8765/'));
  await M.click('text=Sign in with Google');
  await M.waitForTimeout(4000);
  const toastText = await M.locator('#toast').textContent();
  check(/already used/.test(toastText), `used link refused: "${toastText}"`);
  check(!(await M.locator('.list-card .name').allTextContents()).includes('Kitchen'), 'mallory does not see the Kitchen list');

  // 6. Izzat removes Aisyah; she loses access.
  await A.goto('http://localhost:8765/#/household'); await A.waitForSelector('text=Remove');
  await A.click('text=Remove'); await A.waitForTimeout(1500);
  await W.waitForTimeout(4000);
  check(!(await W.locator('.list-card .name').allTextContents()).includes('Kitchen'), 'removed member no longer sees the list (live)');
  check(/no longer in that household/.test(await W.locator('#toast').textContent()) || (await W.locator('h1').first().textContent()) === 'Your lists', 'removed member lands on her own lists, not an error');
  check(await W.locator('text=Could not load your data').count() === 0, 'no error screen after removal');
  await W.reload(); await W.waitForTimeout(4000);
  check(!(await W.locator('.list-card .name').allTextContents()).includes('Kitchen'), 'removed member still cannot see it after reload');

  for (const [n, p] of [['izzat', A], ['wife', W], ['mallory', M]]) {
    const real = p.errs.filter((e) => !/permission|Missing or insufficient|offline|Failed to get document|evaluation error|false for/i.test(e));
    check(real.length === 0, `${n}: no unexpected console errors ${real.length ? JSON.stringify(real.slice(0, 3)) : ''}`);
  }
  await b.close();
  log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
