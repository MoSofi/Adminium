<!-- produced from apps/docs/src/content/docs/guides/apps/shared-menu.md § When one app leaves; do not edit -->

# A menu two apps share: When one app leaves

Uninstall either app and the shared tables stay, for the other:

- **The preview names the other app.** The uninstall dialog lists the shared tables as kept:
  "Online Ordering also uses 4 tables, never deleted". **Also delete its tables and data** drops
  only tables no other app uses. It makes no difference which app made the menu first.
- **Its rules are handed over.** The labels and choices the leaving app kept on the shared tables
  pass to the app that stays (to the first installed, when several do), so the menu reads as it
  did. They survive that app's updates, unless a version of it declares its own value for the same
  column, which then replaces the handed one. They are taken back when the last app using the
  table leaves. A rule someone changed by hand stays theirs, as always.
- **Its sample rows stay.** Sample rows the leaving app put in the shared tables are kept with
  them. Remove its sample data before uninstalling to take them out.

**Reinstalling.** An app installed again beside a menu it used to share is offered that menu
again, recommended, exactly as the first time. It can still choose **Keep a separate menu**.
