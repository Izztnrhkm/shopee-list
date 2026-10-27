# Operations

## Where the app lives

| Address | Use |
| --- | --- |
| https://shopee-list-dea0e.firebaseapp.com/ | **Main address.** Use this one, and add this one to your phone's home screen. Sign-in works in the browser and in the iPhone home-screen app. |
| https://izztnrhkm.github.io/shopee-list/ | Old address (GitHub Pages). Still works in a browser tab. An iPhone home-screen app added from here cannot sign in; it shows a button to the main address. |

Both addresses use the same Firebase project, so lists are the same on both.

**Why two addresses:** on an iPhone home-screen app, iOS blocks the Google sign-in pop-up, so the app signs in by redirect. Safari 16.1+ only allows redirect sign-in when the app and its sign-in helper (`/__/auth/handler`) are on the same address, which is the Firebase Hosting address. See Firebase's [redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices).

## Deploys

Every push to `main` deploys automatically:

- **Firebase Hosting**: `.github/workflows/firebase-hosting.yml` runs the logic tests, then deploys with [FirebaseExtended/action-hosting-deploy](https://github.com/FirebaseExtended/action-hosting-deploy). `firebase.json` lists what is served; tests, docs and rules are not.
- **GitHub Pages**: GitHub's built-in Pages build.

To redeploy without a code change: GitHub › Actions › Deploy to Firebase Hosting › Run workflow.

### One-time setup: the deploy key

The workflow needs the repository secret `FIREBASE_SERVICE_ACCOUNT_SHOPEE_LIST`.

1. Open [Google Cloud › Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=shopee-list-dea0e) and check the project is **shopee-list-dea0e**.
2. **+ Create service account**. Name: `github-deploy`. **Create and continue**.
3. Add two roles: **Firebase Hosting Admin** and **API Keys Viewer**. **Continue**, **Done**.
4. Open the new account › **Keys** › **Add key** › **Create new key** › **JSON** › **Create**. A `.json` file downloads.
5. Open [GitHub › repo Settings › Secrets and variables › Actions](https://github.com/Izztnrhkm/shopee-list/settings/secrets/actions) › **New repository secret**. Name: `FIREBASE_SERVICE_ACCOUNT_SHOPEE_LIST`. Secret: open the `.json` file in Notepad, copy everything, paste. **Add secret**.
6. Delete the downloaded `.json` file. Anyone with it can deploy to your hosting.

These two roles can publish the website only; they cannot read or change your lists.

## Security rules

`firestore.rules` is not deployed automatically. After changing it: Firebase console › Firestore Database › Rules › paste the file › **Publish**. Test first: from `tests/`, `npm install` then `npm run test:rules`.
