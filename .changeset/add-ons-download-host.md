---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

**Add-ons download from downloads.adminium.dev instead of the npm registry.**
With browsing online switched on, the catalog comes from
`https://adminium.dev/marketplace/v2/catalog.json`, and each add-on from
`https://downloads.adminium.dev/add-ons/<key>/<key>-<version>.tgz`. The server
builds that address itself from the catalog's key and exact version, and the
downloaded bytes must still match the sha512 the release recorded before
anything is unpacked. `registry.npmjs.org` is no longer contacted. Browsing
online stays off by default, and `ADMINIUM_NETWORK_FEATURES=off` and the
desktop app's air-gap mode still veto it.

After upgrading, refresh the catalog once. A catalog cached by an earlier
version is in the old format, so until the refresh the Add-ons page lists only
what is already on disk, and a download asks for the refresh.

The bundled add-ons in the Docker image and the desktop app are fetched from
the same host when they are built, against the same pinned hashes.

The sideload card and the app upload step now point to the sha512 fingerprint
published with each release, instead of `npm pack --json`.

If you filter the audit log: a finished download records `source: 'download'`
(it was `'npm'`), a download whose bytes do not match is recorded as
`add-on.verify-refused` (the same action as a refused upload), and download
failures carry the reasons `TARBALL_NOT_FOUND` and `DOWNLOAD_ADDRESS_MISMATCH`.
`PACKUMENT_UNREACHABLE`, `VERSION_NOT_PUBLISHED`, `LEDGER_MISMATCH` and
`FOREIGN_TARBALL_HOST` no longer occur.
