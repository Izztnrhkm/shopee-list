# Operations

## Where the app lives

| Address | Use |
| --- | --- |
| https://shopee-list-dea0e.firebaseapp.com/ | **Main address.** Use this one, and add this one to your phone's home screen. Sign-in works in the browser and in the iPhone home-screen app. |
| https://izztnrhkm.github.io/shopee-list/ | Old address (GitHub Pages). Sends every visit, import link and invite link to the main address. |

Both addresses use the same Firebase project, so lists are the same on both.

**Why two addresses:** on an iPhone home-screen app, iOS blocks the Google sign-in pop-up, so the app signs in by redirect. Safari 16.1+ only allows redirect sign-in when the app and its sign-in helper (`/__/auth/handler`) are on the same address, which is the Firebase Hosting address. See Firebase's [redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices).

## Deploys

Every push to `main` deploys automatically:

- **Firebase Hosting**: `.github/workflows/firebase-hosting.yml` runs the logic tests, then deploys with [FirebaseExtended/action-hosting-deploy](https://github.com/FirebaseExtended/action-hosting-deploy). `firebase.json` lists what is served; tests, docs and rules are not.
- **GitHub Pages**: GitHub's built-in Pages build.
- **Security rules**: `.github/workflows/firestore-rules.yml` runs when `firestore.rules` (or its tests) changes: it runs the rules tests in the Firestore emulator, then publishes the rules. On a pull request it only runs the tests. See [Security rules](#security-rules).

To redeploy without a code change: GitHub › Actions › Deploy to Firebase Hosting › Run workflow.

Each deploy writes `version.json` (the short commit id). An open app checks it when it comes back to the front and every 5 minutes, and shows a **New version ready · Refresh** pill when it changed. People can also refresh any time with the circular-arrow button in the header or by pulling the page down from the top. `version.json` is not in the repo (`.gitignore`), so a local copy simply never shows the pill.

### One-time setup: the deploy key

Both workflows use the repository secret `FIREBASE_SERVICE_ACCOUNT_SHOPEE_LIST`.

1. Open [Google Cloud › Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=shopee-list-dea0e) and check the project is **shopee-list-dea0e**.
2. **+ Create service account**. Name: `github-deploy`. **Create and continue**.
3. Add four roles: **Firebase Hosting Admin**, **API Keys Viewer**, **Service Usage Consumer** (the deploy checks that Hosting is enabled; without this role it fails with "403 Permission denied to get service firebasehosting.googleapis.com") and **Firebase Rules Admin** (publishes `firestore.rules`). **Continue**, **Done**.
4. Open the new account › **Keys** › **Add key** › **Create new key** › **JSON** › **Create**. A `.json` file downloads.
5. Open [GitHub › repo Settings › Secrets and variables › Actions](https://github.com/Izztnrhkm/shopee-list/settings/secrets/actions) › **New repository secret**. Name: `FIREBASE_SERVICE_ACCOUNT_SHOPEE_LIST`. Secret: open the `.json` file in Notepad, copy everything, paste. **Add secret**.
6. Delete the downloaded `.json` file. Anyone with it can deploy to your hosting.

These roles cannot read or change your lists directly. But Firebase Rules Admin can replace the security rules, and rules decide who can read the lists, so treat the key as having access to your data: keep it only in the GitHub secret.

**Adding the rules role to an existing key:** open [Google Cloud › IAM](https://console.cloud.google.com/iam-admin/iam?project=shopee-list-dea0e), find the deploy account (`github-deploy@shopee-list-dea0e.iam.gserviceaccount.com` if you named it as above), click the pencil, **Add another role** › **Firebase Rules Admin** › **Save**. The key in the GitHub secret keeps working; no new key is needed.

## Security rules

`firestore.rules` in this repo is the source of truth. A push to `main` that changes it publishes it (after the rules tests pass), so **do not edit the rules in the Firebase console**: the next publish replaces console edits. To change the rules, change the file (with a test in `tests/rules.test.mjs`) and merge. To publish again without a change: GitHub › Actions › Firestore rules › Run workflow. If the rules are unchanged, the publish does nothing.

To test locally: from `tests/`, `npm ci` then `npm run test:rules` (Java 21 or later).

## Sign-in on iPhone home-screen app

The home-screen app signs in by redirect. Firebase marks a redirect in progress in sessionStorage, which iOS can drop on the way to Google and back; the app keeps its own mark in localStorage (`shopee-list-redirect`, valid 15 minutes) and restores Firebase's mark before collecting the result. If a sign-in still does not finish, the sign-in screen shows a line like `[home-screen, note lost, restored, empty]`: send that to Claude.

## Backups

Household tab › **Download backup** saves every list and item as a `.json` file (open it in any text editor). Firebase's own scheduled backups need the paid Blaze plan, so this is the free way. Suggested: once a month, and before any big change. To restore, give the file to Claude: it holds the same fields as the database (`lists`, `products`), so it can be written back with the same ids.

Your lists from before households also still sit under your account (`users/{uid}/lists`, `users/{uid}/products`) as a read-only copy from 26 Oct.
