# Shopee List

A phone-first shopping list for Shopee Malaysia (shopee.com.my) that syncs between your devices.

- Keep several lists, e.g. "Raya" or "Kitchen". Each item shows its photo, price, verdict and the reason it is the pick.
- Set a priority (Must-have, Should have, Nice to have) and tag items for the next Shopee double-day sale (11.11, 12.12…).
- **Buy next** gathers every must-have across your lists with a total, and a second view lists everything waiting for the sale.
- For each item, compare the Shopee listings you are considering: price, shipping, rating, sold count, seller type, where it ships from, vouchers and notes. The pick drives the list totals.
- **Price history:** every re-check (typed in, or a new import from Claude) adds a dated price, so the item shows up or down since research and the lowest price seen.

- **Add from Claude:** pick one or several lists from the research library in the app, or paste an import block from a chat. Every item is added with its best listings and a verdict (Worth it, Consider, Skip) with pros, cons and sources. See [docs/IMPORT.md](docs/IMPORT.md).
- **Research library:** ready-made researched lists at [/research/](https://izztnrhkm.github.io/shopee-list/research/). Tap **Add to Shopee List** on any of them to import it. The data lives in `research/<date>/*.json`, listed in `research/index.json`.

The app itself does not read Shopee: Shopee blocks automated access, so research happens in a Claude chat that can use your Chrome browser, or you type details in yourself.

## Tests

`node --test tests/*.test.mjs` checks the import, price history and sale-date logic (Node 18 or later, no installs).

## How it works

- A static site (HTML, CSS, plain JavaScript modules, no build step), hosted on GitHub Pages.
- Google sign-in through Firebase Authentication.
- Data in Cloud Firestore, under `users/{uid}/...`. `firestore.rules` lets each signed-in user read and write only their own data.
- Firestore's offline cache keeps the app usable without a connection. Changes sync when you are back online.

The Firebase config in `js/firebase-config.js` is public by design. It identifies the project but does not grant access; the security rules do that.

## One-time setup

In the [Firebase console](https://console.firebase.google.com) for project `shopee-list-dea0e`:

1. **Authentication > Sign-in method**: enable **Google**.
2. **Authentication > Settings > Authorized domains**: add `izztnrhkm.github.io`.
3. **Firestore Database**: create the database if you have not, then open **Rules**, replace everything with the contents of `firestore.rules`, and click **Publish**.

In this GitHub repo:

4. **Settings > Pages**: under "Build and deployment", set Source to **Deploy from a branch**, branch **main**, folder **/ (root)**, then Save.

The site will be at https://izztnrhkm.github.io/shopee-list/ a minute or two later.

### Optional: lock the database to your account only

By default anyone with a Google account can sign in and create their own separate lists in your Firebase project (they can never see yours). To allow only you:

1. Sign in to the app once.
2. In Firebase console > Authentication > Users, copy your **User UID**.
3. In the rules, change the condition to `request.auth != null && request.auth.uid == uid && uid == 'YOUR_UID'` and publish.

## Run locally

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. `localhost` is an authorized domain in Firebase by default.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell |
| `css/styles.css` | Styles, light and dark |
| `js/app.js` | Screens, routing, forms |
| `js/store.js` | Firebase sign-in and database access |
| `js/util.js` | Parsing and formatting helpers |
| `js/importer.js` | Reads and checks import data from Claude |
| `docs/IMPORT.md` | Import format and the prompt to use with Claude |
| `js/firebase-config.js` | Firebase project config |
| `fonts/` | Plus Jakarta Sans, self-hosted (SIL Open Font License, `fonts/OFL.txt`) |
| `tests/` | Logic tests, run with `node --test tests/*.test.mjs` |
| `firestore.rules` | Database security rules |
| `research/index.html` | Research library page (import links built in the browser) |
| `research/index.json` | List of research files shown in the library |
| `research/<date>/*.json` | Researched lists in the import format |
