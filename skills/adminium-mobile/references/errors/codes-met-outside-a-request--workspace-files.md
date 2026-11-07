<!-- produced from apps/docs/src/content/docs/reference/errors.md § Codes met outside a request — Workspace files; do not edit -->

# Error codes: Codes met outside a request — Workspace files

### Workspace files

Saving (`POST /api/v1/workspaces/:id/save`), uploading (`POST /apps/upload-workspace`) and
installing (`POST /apps/workspace/:id/install`) a [workspace file](https://docs.adminium.dev/guides/workspaces/files/)
answer with `details.reason`. A refusal of the whole file stages nothing.

| Status | `details.reason` | When |
|---|---|---|
| `422` | `WORKSPACE_SAVE_EMPTY` | No database was chosen to save. |
| `422` | `WORKSPACE_SAVE_TOO_MANY` | More than eight databases: a workspace file holds at most eight apps. |
| `422` | `WORKSPACE_SAVE_NOT_MEMBER` | A database named is not in this workspace. |
| `422` | `WORKSPACE_SAVE_DUPLICATE`, `WORKSPACE_SAVE_DUPLICATE_KEY` | A database named twice, or two apps given the same key. |
| `422` | `WORKSPACE_SAVE_INSTANCE_FROM` | The server settings were said to come from a database that is not saved. |
| `409` | `WORKSPACE_APP_TOO_LARGE` | One app would be over 32 MB. Leave out its sample rows. No version is used up. |
| `409` | `WORKSPACE_FILE_TOO_LARGE` | The whole file would be over 128 MB. Leave out a database or its sample rows. No version is used up. |
| `409` | `WORKSPACE_FILE_CHANGED` | Download again could not make the same bytes as the file that was saved. Save the workspace again. |
| `422` | `WORKSPACE_FILE_MISSING` | The upload carries no `workspace.json`: it is not a workspace file. |
| `422` | `WORKSPACE_FILE_INVALID` | Its `workspace.json` cannot be read or is not valid, or it has no `manifest.json` beside it. `details.issues` lists why. |
| `422` | `WORKSPACE_FILE_EXTRA` | It carries files its `workspace.json` does not name. |
| `422` | `WORKSPACE_FILE_MEMBER_MISSING` | It names an app file it does not carry. |
| `422` | `WORKSPACE_FILE_INTEGRITY` | An app inside is not the file that was saved: its fingerprint does not match the list. |
| `422` | `WORKSPACE_FILE_APP_MISMATCH` | An app inside holds another key or version than the list says. |
| `422` | `WORKSPACE_FILE_NESTED` | An app inside is itself a workspace file. |
| `422` | `WORKSPACE_FILE_TWO_INSTANCES` | Two apps inside carry the server settings. |
| `403` | `WORKSPACE_CHOICE_NOT_YOURS` | Creating or adding to a workspace, by someone who may not manage connections. Install with `"workspace": { "mode": "none" }`. |
| `409` | `WORKSPACE_NAME_TAKEN` (code `UNIQUE_VIOLATION`) | A workspace already has the name the file would create. Add to it instead. |
| `422` | `WORKSPACE_APP_UNKNOWN` | The install names an app the file does not hold. |
| `422` | `WORKSPACE_TARGET_UNKNOWN` | An app was sent to a database that is not connected here. Connect it first. |
| `409` | `WORKSPACE_INSTALL_RUNNING` | This file is being installed already. Wait for that run to finish. |
| `409` | `WORKSPACE_INSTALL_FINISHED` | The file was installed, or discarded. Upload it again. |

A refusal of one app inside (an older version, another app with the key) is not an error of the
request: it is recorded on that app's row, the other apps go on, and the run's reply says so. An app
whose staged file went away reads `WORKSPACE_APP_NOT_STAGED`: upload the file again. A file that
needs a newer Adminium is refused with `REQUIRES_NEWER_ADMINIUM`, as an app file is.
