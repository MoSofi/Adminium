---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
'@adminium/ui': patch
---

**Each installed app has its own settings page, sidebar section and place in the command palette.**

**Studio → Hosted apps → <app>** shows the app's sets of screens — staff and customer, each
switched on or off, and whether the staff screens live inside the dashboard or on their own
address — with their addresses and domains; its business type; and **Disable**, **Update** and
**Uninstall**. Disabling hides the app everywhere and stops its endpoints without deleting
anything. Extra instances — the same app on another database, at `/apps/<key>/<slug>/staff/` —
are set on **Hosted apps**.

The app's pages sit in its own sidebar section under its name and version. The command palette
finds the app's pages and its staff screens — also those of an app that opens on its own
address, and each extra instance — and opens them where they live.

A customer domain serves only the app's own pages and `/api/v1/public/*`. A browser that asks it
for anything else gets a plain "Page not found" page in the reader's language (API calls keep
the JSON envelope); a switched-off side gets "not available" (503); someone signed in without
access to the staff screens gets "This account can't open <app>" with a sign-out.
