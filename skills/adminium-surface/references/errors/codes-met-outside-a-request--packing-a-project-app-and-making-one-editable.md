<!-- produced from apps/docs/src/content/docs/reference/errors.md § Codes met outside a request — Packing a project app, and making one editable; do not edit -->

# Error codes: Codes met outside a request — Packing a project app, and making one editable

### Packing a project app, and making one editable

`POST /api/v1/project/apps/:key/pack` (Download) and `POST /api/v1/apps/:key/editable` (Make it
editable here) answer with `details.reason`:

| Status | `details.reason` | When |
|---|---|---|
| `404` (pack), `422` (editable) | `NO_PROJECT` | This server runs no project folder. |
| `404` | `NOT_A_PROJECT_APP` | There is no `apps/<key>/` folder for that key. |
| `404` | `NOT_PACKED` | That version was not packed here: download it first. |
| `422` | `CATALOG_SIDES` | The folder's app is published by someone else: only an app made here is packed. |
| `422` | `VERSION_BELOW` | The version asked for is lower than the folder's manifest. `details.manifestVersion` says it. |
| `422` | `PACK_CHECK_FAILED` | The app does not pass `adminium app check`. `details.problems` lists why. |
| `422` | `PACK_BUILD_FAILED` | Its screens could not be built (for example, the project has no `esbuild`). |
| `422` | `PACK_TOO_LARGE` | The package would be over 32 MB. `details.bytes` and `details.limit` say by how much. |
| `422` | `NO_SOURCE` | The installed file carries no source, so there is nothing to make editable. |
| `422` | `FOLDER_EXISTS` | `apps/<key>/` already exists. Rename or remove that folder first. |
| `422` | `SEVERAL_INSTALLS` | The app is installed on several databases, and a folder app runs once per server. Remove the other copies first. |
| `422` | `FROM_FOLDER` | The app already comes from the project folder. |

Once an app is editable here, an upload of its key is refused with `details.reason: "KEY_IN_PROJECT"`.
