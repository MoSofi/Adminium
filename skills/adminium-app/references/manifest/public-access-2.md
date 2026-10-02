<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access; do not edit -->

# Manifest spec: Public access

| Field | Required | Rule |
|---|---|---|
| `table` | yes | One of the app's table refs. |
| `methods` | yes | At least one of `GET`, `POST`, `PATCH`. `PATCH` needs a `claim`, a `claimedBy` that is not `optional`, or a `visibleWith`. |
| `kind` | no | `records` (the default) or `availability`. |
| `key` | no | The browser key that serves the entry: `customer` (the default) or a name in [`publicKeys`](https://docs.adminium.dev/reference/manifest/#publickeys). |
| `select` | no | The columns a response carries. Default: every column the app declares for the table. An entry with `claimedBy` must list them. |
| `writable` | no | The columns a create or change may set. Never a column whose value Adminium decides. |
| `writableValues` | no | `{ "<column>": [1–32 values] }`: the only values a browser may write into a writable column, on a create or a change. Each value must fit the column. |
| `writableWhen` | no | The state a row must be in to be changed, per column: `[1–32 values]`, where `null` stands for "still empty" (on a nullable column); `"from-now"`, a `timestamptz` still ahead; `{ "within": <minutes> }`, a `timestamptz` no more than that many minutes ahead (1–1440; a past time always passes; at most one per entry); `"from-today"`, a `date` of today or later on the venue's calendar; `"before-today"`, a `date` already past; or a window on a moment, `{ "after"?, "before"?, "where"? }`, see [Windows on a moment](https://docs.adminium.dev/reference/manifest/#windows-on-a-moment). Needs `PATCH`, except a window keyed by a `visibleWith` link on a create. |
| `requires` | no | 1–8 `writable` columns every write through the entry must fill: accepting a proposal carries the name typed as its signature. |
| `filters` | no | Rows the endpoint can reach at all. See [Filters](https://docs.adminium.dev/reference/manifest/#filters). |
| `defaults` | no | Values the server writes whatever the browser sends. |
| `claim` | no | How a person proves who they are: by a row's details, by a link emailed to them, or by a token. Makes the entry its key's identity. See [A person's own rows](https://docs.adminium.dev/reference/manifest/#a-persons-own-rows). |
| `claimedBy` | no | `{ "table", "column", "optional"? }`. The entry reaches only the rows of the person its key's identity claimed. |
| `visibleWith` | no | `{ "table", "via" }`. The entry reaches a row only where the entry on `table` (on the same key) reaches the row it belongs to: an invoice's lines are exactly as visible as the invoice. See [Rows visible with their parent](https://docs.adminium.dev/reference/manifest/#rows-visible-with-their-parent). |
| `level` | no | `lookup` (the default) or `verified`: the session the entry needs. Only with `claimedBy` or `visibleWith`. |
| `files` | no | 1–8 `text` columns holding a file, which a signed-in person may download: the file the row names, never one by its id. Each is in `select`. Needs a `claim`, `claimedBy` or `visibleWith`. |
| `documents` | no | 1–8 document kinds (see [Documents](https://docs.adminium.dev/reference/manifest/#documents)) a signed-in person may list and open for the rows the entry reaches. Needs a `claim`, `claimedBy` or `visibleWith`. |
| `sensitive` | no | Whether the rows need a verified session to see. See [A person's own rows](https://docs.adminium.dev/reference/manifest/#a-persons-own-rows). |
| `reason` | with `sensitive: false` | Why the entry is not sensitive, 1–200 characters. Only with `sensitive: false`. |
| `onClaim` | no | `{ "clear": [1–12 columns] }`: on an entry whose `claimedBy` is `optional`, the nullable columns a signed-in create empties (the name and number a first visit would type). |
| `maxOpen` | no | `{ "column", "values", "n", "upcoming"? }`: a claimed person may hold at most `n` (1–50) rows whose column holds one of `values`. With `upcoming`, a `timestamptz`, only rows still ahead count. Needs `claimedBy` and `POST`. |
| `rank` | no | `{ "orderBy", "where"? }`: a create also answers where the new row stands, as the number of rows ordered by `orderBy` at or before it. `where` is `{ "column", "eq" }`. Needs `POST`. |
| `humanCheck` | no | `true`: the browser solves a small proof of work before a create or a claim is taken. Only on an entry that creates or claims. |
| `anonymous` | no | Limits on a create nobody signed in for. See [Limits on a stranger's create](https://docs.adminium.dev/reference/manifest/#limits-on-a-strangers-create). |
| `requireSetting` | no | Up to 4 `{ "table", "column", "when"? }`, each a bool of the settings table. While one is false, every write through the entry is refused. |
| `confirm` | no | An email Adminium sends when a guest creates a row; needs `POST`. See below. |
| `children` | no | The rows a create carries with it, by child table, two levels at most. See [A create with its child rows](https://docs.adminium.dev/reference/manifest/#a-create-with-its-child-rows). |
| `agrees` | no | 1–8 checks the created row's own values must pass (guests no more than a room sleeps). See [A create with its child rows](https://docs.adminium.dev/reference/manifest/#a-create-with-its-child-rows). |
| `dryRun` | no | `true`: the create or change may be tried without writing, to see every figure Adminium would work out. See [Dry runs, price checks and retries](https://docs.adminium.dev/reference/manifest/#dry-runs-price-checks-and-retries). |
| `expect` | no | A money column Adminium works out, which the write may send its expected value for; a different figure writes nothing. |
| `clientKey` | no | A column holding a key the browser mints, so a retried create lands on the same row. |
| `identity` | no | On a create, the person it is made for, found or made by the address typed. See [A person found by address](https://docs.adminium.dev/reference/manifest/#a-person-found-by-address). |
| `shareLink` | no | A share-code column: a create answers, once, the new row's own link. See [A row's own link](https://docs.adminium.dev/reference/manifest/#a-rows-own-link). |
| `newLink` | no | `{ "column", "kind", "when"? }`: "Make a new link" for a signed-in person's row, or "Send it again" through a row's own link. See [A row's own link](https://docs.adminium.dev/reference/manifest/#a-rows-own-link). |
| `forget` | no | On an identity entry: what "delete my details" empties. See [Delete my details](https://docs.adminium.dev/reference/manifest/#delete-my-details). |
| `withhold` | no | Columns left out of a row for some readers. See [Withheld columns](https://docs.adminium.dev/reference/manifest/#withheld-columns). |
| `limits` | no | Limits on a change a guest makes. See [Limits on a guest's change](https://docs.adminium.dev/reference/manifest/#limits-on-a-guests-change). |
| `unlockBy` | no | Rows readable only with a code that unlocks them. See [Codes that unlock rows](https://docs.adminium.dev/reference/manifest/#codes-that-unlock-rows). |
| `pictures` | no | 1–4 image columns any visitor may see. See [Pictures](https://docs.adminium.dev/reference/manifest/#pictures). |
| `rule`, `showLeft`, `under` | no | On an `availability` entry: which limit it answers, whether it says what is left, and the column a page asks by. See [Availability](https://docs.adminium.dev/reference/manifest/#availability). |
