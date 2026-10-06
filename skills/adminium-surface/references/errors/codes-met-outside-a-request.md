<!-- produced from apps/docs/src/content/docs/reference/errors.md § Codes met outside a request; do not edit -->

# Error codes: Codes met outside a request

### An email that is not sent

An email is never sent without its list. When the table or link an [email that lists
rows](https://docs.adminium.dev/reference/manifest/#emails-that-list-rows) reads is gone (after a rename, say), the outbox
row is marked `failed` with the sentence "Not sent: the email lists rows from a table or link that
is not there" in its error column. This is text on the row, not an HTTP code. An empty list still
sends. The other sentences are in [app emails](https://docs.adminium.dev/guides/apps/emails/#sending).

### An app's install check

`POST /apps/plan` lists what stops an install in `problems`, each with a `code`, `table` and
`column`. An install that meets one is refused `422` `VALIDATION_FAILED` with
`details.reason: "PLAN_REFUSED"` and the same `problems`.

| Code | Meaning |
|---|---|
| `UNIQUE_DUPLICATES` | A unique rule the install adds, which rows already in the table break. Make them differ, then check again. |
| `UNIQUE_KEY_TOO_LONG` | On MySQL, a unique column or set of columns wider than MySQL can index (3072 bytes together, 768 characters for one text column). Make the text columns shorter. |

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

### Saving an endpoint in Studio

An endpoint Studio cannot compile is refused `422` `VALIDATION_FAILED`, with
`details.issues` listing each problem's `code`, `message` and, where there is one, `column`. The
codes the endpoint features for app pages raise (child rows, quotes, retries, windows, codes):

| Code | Meaning |
|---|---|
| `ENDPOINT_CHILDREN_NO_CREATE` | Child rows, or a dry run, on an endpoint that makes nothing, a batch, an identity or a child endpoint. |
| `ENDPOINT_CHILDREN_NEED_PROOF` | A create anyone may make with child rows must ask the human check. |
| `ENDPOINT_CHILD_UNKNOWN`, `ENDPOINT_CHILD_TWICE`, `ENDPOINT_CHILD_VIA_NOT_PARENT` | A child list names a table that is not there, a table already in the write, or a link that does not point at its parent. |
| `ENDPOINT_CHILD_ROWS`, `ENDPOINT_CHILD_DEPTH` | A list's least is above its most, or lists go more than two levels down. |
| `ENDPOINT_CHILD_SELECT_UNKNOWN`, `SCOPE_CHILD_UNKNOWN_COLUMN` | A child list names a column its table does not have. |
| `ENDPOINT_CHILD_WRITABLE_DECIDED`, `ENDPOINT_WRITABLE_DECIDED` | A column Adminium decides (a total, a stamp) cannot be writable. |
| `ENDPOINT_CHILD_COUNTS`, `ENDPOINT_CHILD_AGREES_PATH` | A count by group or an agreement that does not follow foreign keys to what it compares. |
| `ENDPOINT_CLIENT_KEY` | A retry key must be a text column the caller writes and nothing shows, filters or orders by. |
| `ENDPOINT_EXPECT_COLUMN` | A price check must name a number column Adminium works out, which the endpoint shows. |
| `ENDPOINT_AVAILABILITY_SHAPE`, `ENDPOINT_AVAILABILITY_ONE_ROW` | `show_left` or `under` on a limit that cannot answer them, or availability of a night limit whose pool is a single row (one room). |
| `ENDPOINT_VISIBLE_WITH_GUARDED` | A child endpoint on a table with a booking limit is created one row at a time, never in a batch. |
| `SCOPE_WRITABLE_WHEN_MOMENT_INVALID` | A window on a moment that cannot be read: its ends mix linked and own columns, a column that is not a date or time, or, on an endpoint that only creates, a window not keyed by the link to its parent. |
| `ENDPOINT_UNLOCK_NOT_A_CODE` | The column an unlock looks codes up in must be unique (alone, or with its scope) and stored as a code (`normalize: "code"`). |
| `ENDPOINT_UNLOCK_SHARE_CODE` | The column opens rows by a shared link, so it is never looked up. |
| `ENDPOINT_UNLOCK_ALONE`, `ENDPOINT_UNLOCK_READ_ONLY`, `ENDPOINT_UNLOCK_UNKNOWN_COLUMN`, `SCOPE_UNLOCK_SHAPE` | An unlock is its own read-only endpoint, with no claim, identity, parent or availability, over columns that exist. |
| `ENDPOINT_SHARE_LINK_NOT_A_CODE` | A row's own link must be a code of 16 characters Adminium makes, never shown, on a single create. |
| `ENDPOINT_NEW_LINK_SHAPE` | "Make a new link" renews a row's own link code on a signed-in person's rows. |
| `ENDPOINT_OWN_ADDRESS_SHAPE` | A link is emailed to its row's own address only for the row's own link, from a text column holding an address, each named once. |
| `ENDPOINT_FIND_OR_CREATE_SHAPE`, `SCOPE_FIND_OR_CREATE_READS_PERSON` | A person found by address: on a create alone (or a change through the row's own link), never batched, and never showing columns of the person a stranger could have typed the address of. |
| `ENDPOINT_LIMITS_SHAPE` | `limits` count a guest's changes one at a time: a PATCH, never a batch. |
| `ENDPOINT_WITHHOLD_SHAPE`, `SCOPE_WITHHOLD_SHAPE` | Withheld columns: only on a signed-in person's rows read through a parent (or on a row's own link), shown by the endpoint, never filtered, searched or ordered by, and decided by columns that are not writable. |
| `ENDPOINT_SESSION_ONLY_READS`, `SCOPE_SESSION_ONLY_WRITES` | A read for a session's holder alone is an authenticated GET with no claim of its own, and only reads. |
| `SCOPE_FORGET_COLUMN` | "Delete my details" is declared on the identity, empties columns that can be emptied (never a key), stamps a time column, and stops own links that exist. |
| `ENDPOINT_PICTURES_READ_ONLY`, `ENDPOINT_PICTURES_CLAIMED`, `ENDPOINT_PICTURES_UNKNOWN_COLUMN`, `ENDPOINT_PICTURES_NOT_SELECTED`, `ENDPOINT_PICTURES_WRITABLE` | Pictures are shown to every visitor through a read-only endpoint, from columns it shows and no caller writes. |
| `ENDPOINT_COLUMN_UNKNOWN`, `SCOPE_COLUMN_UNKNOWN` | A column named by one of these settings is not in the table. |
