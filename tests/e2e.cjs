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
  // Deploys write version.json (see the workflow); the local server has none, so serve one.
  await ctx.route('**/version.json*', (r) => r.fulfill({ contentType: 'application/json', body: '{"version":"test"}' }));
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
  await A.waitForTimeout(800);
  check(await A.locator('text=Waiting to be used (1)').count() === 1, 'unused invite shows as waiting');
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
  // Pinned bars stay in view after the screen's entry animation (regression: 27 Oct).
  await W.waitForTimeout(400);
  // Pinned = its bottom edge sits exactly on the tab bar's top edge, and it stays there when the page scrolls.
  const pinned = async (P, sel) => P.evaluate(async (sel) => {
    const e = document.querySelector(sel); const tab = document.querySelector('#tabbar');
    if (!e || !tab) return false;
    const onTab = () => Math.abs(e.getBoundingClientRect().bottom - tab.getBoundingClientRect().top) <= 2;
    const before = onTab();
    document.body.style.minHeight = '3000px'; window.scrollTo(0, 400); await new Promise((r) => setTimeout(r, 50));
    const after = onTab();
    window.scrollTo(0, 0); document.body.style.minHeight = '';
    return before && after;
  }, sel);
  check(await pinned(W, '.totalbar'), 'list totals bar stays pinned above the tabs');
  // Also mid-animation: switch screens by link and measure 60 ms later. A transform on the
  // entering screen (the 27 Oct bug) unpins the bar while it runs, and in some browsers after.
  const midEntry = await W.evaluate(async () => {
    location.hash = '#/next'; await new Promise((r) => setTimeout(r, 300));
    location.hash = '#/l/oldKitchen'; await new Promise((r) => setTimeout(r, 60));
    const e = document.querySelector('.totalbar'); const tab = document.querySelector('#tabbar');
    let a = e && e.parentElement; let transformed = false;
    while (a && a !== document.body) { const cs = getComputedStyle(a); if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none') transformed = true; a = a.parentElement; }
    return !!e && !transformed && Math.abs(e.getBoundingClientRect().bottom - tab.getBoundingClientRect().top) <= 2;
  });
  check(midEntry, 'totals bar stays pinned while the screen animates in');
  await W.goto(`http://localhost:8765/#/l/oldKitchen/p/oldRice`); await W.waitForTimeout(700);
  check(await pinned(W, '.bottom-actions'), 'Mark as bought bar stays pinned on the item page');
  await W.goto(`http://localhost:8765/#/l/oldKitchen`); await W.waitForSelector('li.item');
  await W.click('button[aria-label^="Mark bought: Rice cooker"]');
  await A.goto(`http://localhost:8765/#/l/oldKitchen`);
  await A.waitForSelector('text=Bought by Aisyah', { timeout: 10000 }).catch(() => {});
  await A.click('text=Bought 1').catch(() => {});
  await A.waitForTimeout(500);
  check(await A.locator('text=Bought by Aisyah').count() >= 1, 'Izzat sees "Bought by Aisyah"');
  await A.goto('http://localhost:8765/#/household'); await A.waitForTimeout(1200);
  check((await A.locator('.plan-row .name').allTextContents()).some((t) => t.startsWith('Aisyah')), 'household lists Aisyah as a member');
  check(await A.locator('text=Waiting to be used').count() === 0, 'used invite no longer shows as waiting');
  check(await A.locator('text=by Aisyah').count() >= 1, 'recently bought shows Aisyah');
  await A.screenshot({ path: __dirname + '/e2e-household-after.png' });

  // 4b. Light and dark: header button, Household setting, Auto follows the phone, saved per phone.
  const theme = () => A.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const bg = () => A.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(await theme() === 'light', 'starts light when the phone is light (Auto)');
  await A.click('#theme-btn'); await A.waitForTimeout(800);
  check(await theme() === 'dark' && await bg() === 'rgb(22, 21, 20)', `header button switches to dark (${await bg()})`);
  check(await A.evaluate(() => localStorage.getItem('shopee-list-theme')) === 'dark', 'dark choice saved on this phone');
  check(await A.locator('[aria-label="Appearance"] button[aria-checked="true"]').textContent() === 'Dark', 'Household shows Dark selected');
  check(await A.getAttribute('#theme-btn', 'aria-label') === 'Switch to light mode', 'button label offers light mode');
  await A.reload(); await A.waitForSelector('text=Appearance');
  check(await theme() === 'dark', 'dark is kept after reload');
  await A.click('[aria-label="Appearance"] button:has-text("Light")'); await A.waitForTimeout(800);
  check(await theme() === 'light' && await bg() === 'rgb(246, 245, 243)', 'Household Light switches back');
  await A.click('[aria-label="Appearance"] button:has-text("Auto")'); await A.waitForTimeout(800);
  check(await A.evaluate(() => localStorage.getItem('shopee-list-theme')) === null, 'Auto clears the saved choice');
  await A.emulateMedia({ colorScheme: 'dark' }); await A.waitForTimeout(300);
  check(await theme() === 'dark', 'Auto follows the phone turning dark');
  await A.screenshot({ path: __dirname + '/e2e-household-dark.png' });
  await A.emulateMedia({ colorScheme: 'light' }); await A.waitForTimeout(300);
  check(await theme() === 'light', 'Auto follows the phone turning light');

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
  // 7. Refresh: header button, pull down from the top, and the "New version ready" pill.
  const R = await (await b.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true })).newPage();
  R.errs = []; R.on('pageerror', (e) => R.errs.push(e.message));
  let version = 'aaaaaaa';
  await R.route('**/version.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version }) }));
  const fresh = async () => { await R.goto('http://localhost:8765/'); await R.waitForSelector('#refresh-btn'); await R.waitForTimeout(800); await R.evaluate(() => { window.__old = true; }); };
  const reloaded = async () => { await R.waitForTimeout(1500); await R.waitForSelector('#refresh-btn'); return R.evaluate(() => !window.__old); };
  await fresh();
  const hb = await R.evaluate(() => { const h = document.querySelector('.topbar'); return [h.scrollWidth, h.clientWidth]; });
  check(hb[0] <= hb[1], `header fits a 320 px phone (${hb.join(' / ')})`);
  await R.click('#refresh-btn');
  check(await reloaded(), 'refresh button reloads the app');
  await fresh();
  const pull = (dy, endIt) => R.evaluate(([dy, endIt]) => {
    const t = (y) => new Touch({ identifier: 1, target: document.body, clientX: 160, clientY: y });
    const fire = (type, y) => window.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t(y)], changedTouches: [t(y)], bubbles: true }));
    fire('touchstart', 100);
    for (let y = 100; y <= 100 + dy; y += 10) fire('touchmove', y);
    const state = document.getElementById('ptr').className;
    if (endIt) fire('touchend', 100 + dy);
    return state;
  }, [dy, endIt]);
  check(!/ready/.test(await pull(40, true)), 'a short pull does not refresh');
  await R.waitForTimeout(600);
  check(await R.evaluate(() => window.__old === true), 'page stays after a short pull');
  check(/ready/.test(await pull(120, true)), 'a long pull turns the arrow orange');
  check(await reloaded(), 'letting go after a long pull reloads the app');
  await fresh();
  check(await R.locator('#update-pill').isHidden(), 'no update pill while the version is the same');
  version = 'bbbbbbb';
  await R.evaluate(() => window.dispatchEvent(new Event('focus'))); await R.waitForTimeout(600);
  check(await R.locator('#update-pill').isVisible(), 'update pill appears after a new deploy');
  await R.screenshot({ path: __dirname + '/e2e-update-pill.png' });
  await R.click('#update-pill button');
  check(await reloaded(), 'tapping Refresh on the pill reloads the app');
  check(await R.locator('#update-pill').isHidden(), 'pill is gone after the refresh');
  check(R.errs.length === 0, `refresh: no page errors ${JSON.stringify(R.errs.slice(0, 2))}`);
  await b.close();
  log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
