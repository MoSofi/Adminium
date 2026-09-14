---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

**Uploading an add-on asks only for the file and its hash.** The "Upload a
package" card on Studio → Add-ons used to ask for the add-on key and version as
well. The server staged the package under whatever was typed, and nothing
checked the typed key against the manifest. A key that did not match installed
without complaint and then served no bundle, because an add-on's bundle URLs
are built from its manifest's key.

The server now reads the key and version from the package's `manifest.json`,
which is inside the bytes the integrity value verifies. The card shows what it
read ("Uploaded Holiday Calendars 1.0.0 · Install it from the list above") and
clears the file and hash for the next package. The hash is still required, and
still has to come from somewhere other than the file itself, such as
`npm pack --json`.

The upload now runs the full manifest validator. A manifest that does not
validate, one from a publisher other than Adminium, or an app's manifest is
refused on the card instead of after the package is staged. Refusals say what
was wrong: no `manifest.json`, an integrity value that does not match, or an
archive that cannot be read (with its reason code).

`POST /api/v1/add-ons/upload`: `key` and `version` are now optional. A caller
that still sends them has them checked against the manifest, and a mismatch is
refused with `KEY_MISMATCH` or `VERSION_MISMATCH` before anything is written.
The reply gains `name`.
