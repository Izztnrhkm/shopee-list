# Shopee List

A personal shopping list for Shopee Malaysia (shopee.com.my) that syncs between your phone and computer.

- Keep several lists, e.g. "Raya" or "Kitchen".
- Add items with a quantity and tick them off when bought.
- For each item, save the Shopee listings you are considering and compare them side by side: price, shipping, total, rating, sold count, seller type, where it ships from, vouchers and notes.
- The cheapest total, top rating and most sold are highlighted. Mark one listing as **Chosen** and the list totals use it; otherwise they use the cheapest.

You type in the details yourself. Shopee blocks automated reading of its pages, so the app does not fetch them.

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
| `js/firebase-config.js` | Firebase project config |
| `firestore.rules` | Database security rules |
