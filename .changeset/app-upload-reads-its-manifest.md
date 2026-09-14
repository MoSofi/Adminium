---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

**Uploading an app asks only for the file.** The install wizard's bundle step
used to ask for the app key and version. The server staged the bundle under
whatever was typed, and a key that did not match the bundle's manifest uploaded
fine, then failed on the next step:

    The bundle was uploaded as "clinicx" but its manifest declares "clinic".

The bundle already says which app it is, so the server now reads the key and
version from its `manifest.json` during the upload and returns them with the
app's name. The wizard's later steps use what the server returned. Stepping back
after an upload shows the app it read ("Install Clinic Desk · 0.1.1"), with an
option to upload a different bundle. The optional integrity field stays.

A manifest that does not validate, or that belongs to an add-on, is now refused
on the bundle step, where the file was chosen. Both used to be staged and then
refused at the plan step. Refusals at upload also say what was wrong: no
`manifest.json`, an integrity value that does not match, or an archive that
cannot be read (with its reason code), where they used to say only "The
uploaded bundle was refused."

`POST /api/v1/apps/upload`: `key` and `version` are now optional. A caller that
still sends them has them checked against the manifest, and a mismatch is
refused with `KEY_MISMATCH` or `VERSION_MISMATCH` before anything is written.
The reply gains `name`.
