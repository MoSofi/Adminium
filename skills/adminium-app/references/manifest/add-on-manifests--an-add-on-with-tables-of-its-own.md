<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — An add-on with tables of its own; do not edit -->

# Manifest spec: Add-on manifests — An add-on with tables of its own

### An add-on with tables of its own

| Field | Rule |
|---|---|
| `requiredSchema.prefixed` | `true`. Every table is created as `<key with _ for ->_<ref>`: `stock-kit` and `items` make `stock_kit_items`. A name that is taken is a problem on the check, never a rename. |
| `requiredSchema.tables[].indexes` | Up to six sets of one to five columns, each made as an index. A set equal to a unique set is refused. |
| `seeds` | `[{ "table", "rows" }]` or `[{ "table", "file" }]`: rows written once, at install, into a table that is empty. A value is a plain value, `{ "@t": { "en-US": "…", "de-DE": "…" } }` (written in the installing person's language) or `{ "@ref": "<label>" }` (the key of an earlier row that carries `"@label"`). Never for a ledger or a receipt table. The add-on's sample data may point at a labelled row written in `rows` (not one in a `file`) with the same `{ "@ref" }`: the row is found again by its one-of-a-kind column (`"unique": true`), else by its table's `keyField`. If the owner deleted it, the sample row that names it is left out. |
| `requiredSchema.tables[].appGrants` | The most an app's role may hold of the table. See [What an app's role may hold of an add-on's table](https://docs.adminium.dev/reference/manifest/#what-an-apps-role-may-hold-of-an-add-ons-table). |
| `addOn.settingsTable` | A table that holds exactly one row. It is made at install from the columns' defaults, so every required column has one. |
| `roles` | As an app's. A role grants the add-on's own tables (`table:@items:read`), its own pages (`page:@stock-kit-items:view`) and its settings (`addOn:<key>:settings`). Never `screensOnly`. |
| `sampleData` | As an app's, for its own tables. |
| `publicAccess` | Entries as an app's. One with no `key` is served through the `customer` key of an app that names the add-on, once that is allowed. One with `key` set to the add-on's link key is served through that key. |
| `publicKeys` | At most one key, under a name that is not `customer`, with no `requiresStaff`, `enabledBy` or `peak`. It opens one row by its link and only reads: every entry on it has `"methods": ["GET"]` and either claims by token (`"claim": { "by": "token", "column": "…" }`, on a column with `rules.code { "length": 16, "hiddenFromStaff": true }`) or is read with the row a link opened (`visibleWith`, `claimedBy`). A link that is the row's own (`"own": true`) may also change and remove its row; see [A shopper's own link](https://docs.adminium.dev/reference/manifest/#a-shoppers-own-link). |

A column may keep the name of a table (`"rules": { "tableRef": true }`): Adminium stores it so
that renaming the table it names keeps the rows pointing at it.

From Adminium 0.3.43, an add-on whose `compatibility.minAdminiumVersion` is 0.3.43 or later names
only its own tables in a foreign key's `references`; an app binds it from the app's side (see
[Binding an add-on to the app's rows](https://docs.adminium.dev/reference/manifest/#binding-an-add-on-to-the-apps-rows)). An add-on with an
older floor keeps pointing at a table of the database it is put on, as it always did.

An add-on installed with plain table names before Adminium recorded its tables, then updated to a
version under its own prefix, would leave its rows behind in the plain tables: that update is
refused `409` `ADD_ON_BARE_TABLES`, naming the tables. Adminium never renames an add-on's tables
or moves its rows. An add-on whose tables were recorded keeps their names across such an update.

#### An add-on's entry on each app's key

An add-on's entry with no `key` rides the `customer` key of every app it is attached to. On a table
that keeps the rows of several apps, `appColumn` names the `text` column holding the key of the
app a row is for:

```json
"publicAccess": [
  { "table": "bases", "methods": ["GET"], "select": ["id", "name"], "appColumn": "app" },
  { "table": "designs", "methods": ["POST"], "writable": ["base_id", "name_text"],
    "select": ["id", "code"], "humanCheck": true, "appColumn": "app" }
]
```

Through an app's key the entry reads only the rows whose column holds that app's key, a create
writes that key there whatever the browser sends, and a change never moves it. The column is never
`writable` and never a `default`, and the entry names no `key` and signs nobody in: a key no app
made (the owner's own, the add-on's link key) serves nothing of it. Only an add-on says it. Needs
Adminium 0.3.43.

A table anyone may add to through an entry is never one anyone may read through another on the
same key: ready-made designs a shop offers live in a table of their own, apart from the designs
shoppers save.


#### The rows a signed-in customer holds (`heldBy`)

An add-on keeps some rows for a person by their address, never by a key of the app's table: a pack,
a gift card. `claimedBy` cannot reach those. `heldBy` is a read of exactly the rows held in the
address the session **proved by reading mail**:

```json
{ "table": "vouchers", "methods": ["GET"], "level": "verified",
  "heldBy": { "address": "holder_email" },
  "select": ["id", "public_name", "uses_left", "expires_on", "code_last4"] }
```

The entry is an add-on's, on the app's `customer` key, `GET` only, at level `verified`, with a
`select`. Its column keeps an address in one spelling (`normalize: "email"`). A session that only
found the person, a row's own link, and no session at all are answered as an unknown ref. The address
is what chooses the rows, compared byte for byte on every engine, and is not shown unless the entry
selects it. `from` names a date column: a row dated for a later day is not listed before that day.
Needs 0.3.71.

**Spending what you hold, with no code in the browser.** A read like this shows only a code's last
characters. The holder names a row instead, by typing `held:<key>` where a code goes:

- on a price rule's codes, when the add-on's `adjuster.vouchers.held` names the voucher's holder
  column. Only a row with a holder is found, and the add-on holds it to the proved customer;
- on a `lookup` that names `held`, the address column of the codes table. The row is found only when
  that column holds the address this session proved.

Every miss is the answer an unknown code gets. Both need 0.3.71.

#### A shopper's own link

The add-on's link key may open a row as the row's own link (`"own": true`): a link mailed only to
the row's own address (`address`) or handed once to whoever made the row. Such a link reads its
row and may change it in place, so a shopper who saves a design and comes back keeps one design,
one code and one mailed link:

```json
"publicKeys": { "customiser-link": {} },
"publicAccess": [
  { "table": "designs", "methods": ["POST"], "writable": ["base_id", "values", "email"],
    "select": ["id", "code"], "humanCheck": true, "appColumn": "app", "shareLink": "link_token" },
  { "table": "designs", "key": "customiser-link", "methods": ["GET", "PATCH"],
    "select": ["id", "base_id", "values", "state"], "writable": ["base_id", "values"],
    "writableWhen": { "state": ["draft"] },
    "claim": { "by": "token", "column": "link_token", "own": true, "address": "email" } }
]
```

The create through each app's key answers the new row's own link once (`shareLink`): its code,
the add-on's key name, and a session already open on the row through that key, so the page that
saved the design changes it with no claim. The mailed link opens the same row from any device
(`POST /api/v1/public/claim/token`).
