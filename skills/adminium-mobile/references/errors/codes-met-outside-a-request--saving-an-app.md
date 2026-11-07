<!-- produced from apps/docs/src/content/docs/reference/errors.md § Codes met outside a request — Saving an app; do not edit -->

# Error codes: Codes met outside a request — Saving an app

### Saving an app

`POST /api/v1/apps/save` (and the CLI's `adminium app save`) refuses a save before any file is made.
`POST /apps/save/plan` reports the same things without refusing.

| Status | Code | When |
|---|---|---|
| `409` | `CONFLICT`, `details.reason: "SNAPSHOT_MISSING"` | The database has not been read yet. Refresh its schema, then save. |
| `409` | `CONFLICT`, `details.reason: "APP_KEY_SAVED_ELSEWHERE"` | The key was saved from another database on this server. Give this app another key. |
| `409` | `CONFLICT`, `details.reason: "APP_VERSION_SAVED"` | That version of the app was saved before. A saved version is never saved again. |
| `409` | `CONFLICT`, `details.reason: "APP_VERSION_OLDER"` | The version is not above the last one saved. |
| `409` | `CONFLICT`, `details.reason: "SAVE_ROWS_NOT_YOURS"` | Rows of a table were asked for by someone who may not read and export it, or who reads only part of it. |
| `409` | `CONFLICT`, `details.reason: "SAVE_INSTANCE_NOT_YOURS"` | The server's look and words were asked for by someone who may not manage settings. |
| `409` | `CONFLICT`, `details.reason: "SAVE_FILES_NOT_YOURS"` | The app carries files of the Files library, and the saver may not manage everyone's files. |
| `409` | `CONFLICT`, `details.reason: "SAVE_NEEDS_ANSWERS"` | Items in Check still need an answer. Answer them in `answers`, then save. |
| `409` | `CONFLICT`, `details.reason: "SAVE_REFUSED"` | The file would not pass its own checks (a secret, an id of this server, a file that would not install). The message lists each problem. |
