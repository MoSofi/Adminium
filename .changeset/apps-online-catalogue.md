---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
'@adminium/meta': patch
---

**Hosted apps can browse, download and update from the online app catalogue.**
*Studio → Hosted apps* now lists released apps beside the ones your build
shipped and the ones you uploaded. Installing one downloads it from
`https://downloads.adminium.dev/apps/<key>/<key>-<version>.tgz`, checks the
bytes against the fingerprint the release recorded, unpacks it under the same
hardened limits as an upload, and then opens the usual install wizard — nothing
is created in your database until you confirm the schema plan.

Browsing online is **its own switch**, `apps.catalogEnabled`, separate from the
add-on one and **off by default**: a deployment may want apps listed online and
add-ons not, or the reverse. `ADMINIUM_NETWORK_FEATURES=off` and the desktop
app's air-gap mode veto it exactly as they veto the add-on catalogue, and with
it off nothing from a cached list is offered at all. Browsing stays a disk read;
**Check for newer** is the separate, explicit action that fetches
`https://adminium.dev/marketplace/v2/apps.json`.

**Installed apps can be updated.** A newer version — already on disk, or offered
by the catalogue — puts Update on the app's row. New tables are shown to you as
DDL before they are created, in the database the app already uses; a table that
exists but is missing columns the new version needs refuses the update and names
them; nothing is altered or dropped. The app keeps its row, its connection and
its mounts, and older versions are removed from disk only after the update
succeeds.

Every released app declares the oldest Adminium it runs on. A release that needs
a newer one is listed with the version it needs and cannot be installed, rather
than being hidden.

New endpoints, all behind `manifests.manage`: `PUT /api/v1/apps/catalog`,
`POST /api/v1/apps/catalog/refresh`, `POST /api/v1/apps/download` and
`POST /api/v1/apps/{key}/update`. `GET /api/v1/apps/catalog` keeps its shape and
gains `source`, `state`, `updateTo`, `updateStaged` and `needsNewerAdminium` per
row, plus `onlineEnabled` and `catalogFetchedAt`. Audit actions:
`app.catalog-toggled`, `app.catalog-refreshed`, `app.catalog-refresh-failed`,
`app.staged` (with `source: 'download'`), `app.verify-refused`,
`app.download-failed` and `app.updated`.
