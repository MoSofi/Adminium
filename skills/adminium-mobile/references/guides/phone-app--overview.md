<!-- produced from apps/docs/src/content/docs/guides/apps/phone-app.md; do not edit -->

# A phone app for an app

An app can bring a **phone app** for its customers beside its dashboard pages and its web screens.
It is an [Expo](https://expo.dev) project (React Native) in the app's folder, at
`apps/<key>/mobile/`. Like a [customer side](https://docs.adminium.dev/guides/apps/building-a-side/), it talks to the
[public API](https://docs.adminium.dev/guides/apps/public-access/) and reaches only what the app's `manifest/access.json`
grants. Nobody is signed in as staff in it.

It is a side of the app, and it is not a web side:

- Adminium **builds it only as a preview**, in a project that is being designed or developed
  (`adminium design`, `adminium dev`). `adminium start`, a packed app and an installed app never
  serve it. A phone app is not a second website.
- The preview is the phone app drawn by a browser (Expo's export for the web): close to the
  phone, not the phone. **Open on a phone** runs the real app on a real phone.
- Shipping the app to a store is Expo's own work, outside Adminium. What Adminium gives a
  shipped phone app is its **app key** and the public API.
