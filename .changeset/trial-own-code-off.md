---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

In trial mode and on a paid hosted installation (`ADMINIUM_TRIAL_MODE=on`, `ADMINIUM_HOSTED_MODE=on`) the server takes no code of the user's own. Uploading an add-on or an app (`POST /add-ons/upload`, `/apps/upload`, `/apps/upload-workspace`) is refused with `PACKAGE_UPLOADS_OFF`: add-ons and apps come from the catalog or the image's bundle, and Save as app still downloads. The Designer still runs and builds an app's tables, pages, manifest and screens, but it takes no site template zip, no style of one's own and no hand save from the Code tab (`DESIGNER_UPLOADS_OFF`), and no "Start with an app" (`OWN_CODE_OFF`). It writes nothing in `hooks/` or `actions/` and none of the files a build runs, does not run the app's tests, adds no npm package and makes no phone app: each is refused with fixed words and no question to the person. An app's own build command, the phone app's install and build, and the project's hooks and actions are never run or imported, whatever put them there. `/system/info` says which of these the server takes, and the dashboard shows each upload and "Start with an app" button off, with the reason, instead of hiding it. Without either profile nothing changes.
