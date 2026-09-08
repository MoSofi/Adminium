---
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Three more built pages get an entry point. An audit of every route for inbound
navigation found `/studio/add-ons` was not alone:

- **`/studio/public-api`** had exactly one inbound link — inline prose on the
  Hosted apps page, rendered only for a customer-side surface with no key bound
  yet. So it was unreachable without hosted surfaces, and the link removed
  itself the moment someone bound the key it sent them to mint. It is now a row
  in the Workspace settings cross-link card; the contextual shortcut stays.
- **`/api-keys`** had none at all. It joins the sidebar's `people` group beside
  Team, Roles and the audit log — a key is a principal that carries a role, not
  a personal preference — gated `adminOnly` like its neighbours.
- **`/help` and `/changelog`** had none at all. Both are for every role (the
  router's own note: a viewer hitting a wall needs the docs more than an admin
  does), so they go in the avatar menu below the admin-only Studio section.
