---
'@adminium/i18n': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
'@adminium/server': patch
---

The Roles & permissions editor's messages leave the eagerly bundled `common`
catalogue for a deferred `roles` namespace, which `/settings/roles` loads
before it renders.

`common` ships in every user's first load, so its 76 `roles.*` keys were paid
for on every route by every user, for one lazy admin screen behind a permission
the built-in Admin does not hold. Moving them is what makes room for the new
strings in this release without raising the entry-chunk budget.

**Operators with customised translations:** meta migration `0043` re-files
overrides written against the old `common:roles.*` addresses under `roles:`.
Every key moved, so nothing is copied or left behind.
