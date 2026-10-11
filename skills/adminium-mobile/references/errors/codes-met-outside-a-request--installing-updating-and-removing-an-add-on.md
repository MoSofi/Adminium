<!-- produced from apps/docs/src/content/docs/reference/errors.md § Codes met outside a request — Installing, updating and removing an add-on; do not edit -->

# Error codes: Codes met outside a request — Installing, updating and removing an add-on

### Installing, updating and removing an add-on

The routes under `/add-ons` that install, update or remove an add-on which keeps tables of its
own answer these codes. `details` names the add-on and, where it helps, what to do next.

| Status | Code | Meaning |
|---|---|---|
| `409` | `ADD_ON_SCHEMA_CONNECTION` | Its tables go in one database and several are connected. `details.connections` lists them: send the request again with `connectionId`. |
| `409` | `SCHEMA_DRIFT` | The database changed since the check that was read (`planChecksum`). Check again, then repeat. |
| `422` | `VALIDATION_FAILED`, `details.code: "ADD_ON_PAGE_REF_TAKEN"` | One of its pages has a name another installed add-on has, or one under that add-on's key. A page's name opens it, so the two cannot be installed together. |
| `409` | `ADD_ON_INSTALL_INCOMPLETE` | The install stopped part way. `details.stage` says where (`tables`, `writers`, `seeds`, `finish`). Nothing was undone: the same request finishes it. |
| `409` | `ADD_ON_UPDATE_INCOMPLETE` | The same, for an update. Until it is finished the add-on does nothing. |
| `409` | `ADD_ON_IN_USE` | It cannot be removed: a rule of an app still hands rows to it, or an app uses it for a feature. `details` says which. |
| `403` | `FORBIDDEN` with `details.reason: "DROP_NEEDS_SUPER_ADMIN"` | Deleting its tables with it needs Super Admin. |
| `422` | `VALIDATION_FAILED` with `details.reason: "CONFIRM_KEY_MISMATCH"` | Deleting its tables needs its key typed, as `confirmKey`. |
| `403` | `FORBIDDEN` | `publicAccess: true` was sent by someone who may not manage API keys. Nothing was installed or changed. Send it without, or ask someone who can. |

A request that leaves `publicAccess` out, or sends it by someone who may not allow it on a route
that does not refuse (connecting an add-on to an app, switching it on), succeeds and opens
nothing: the reply's `publicAccess.skipped` lists each entry left off the app's key, with why.
