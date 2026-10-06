<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Postings; do not edit -->

# Manifest spec: requiredSchema — Postings

### Postings

A table's `postings` hand its rows to a [ledger](https://docs.adminium.dev/reference/manifest/#ledgers) an add-on keeps, in the same save. How
they behave, with every way of writing a row, is in
[Rows that post into an add-on's ledger](https://docs.adminium.dev/guides/apps/postings/).

```json
"postings": [
  {
    "id": "stock",
    "into": { "addOn": "inventory", "ledger": "stock", "action": "use" },
    "via": "order_id",
    "reserve": { "on": { "create": true } },
    "post": { "on": { "to": ["picked_up"] } },
    "reverse": { "on": { "to": ["cancelled"], "from": ["placed", "ready"] } },
    "map": { "what": "item_id", "quantity": "quantity" },
    "heldUntil": { "parent": "hold_until" },
    "unlessSet": "voided_at"
  }
]
```

| Field | Required | Rule |
|---|---|---|
| `id` | yes | A lowercase name, unique on the table. Up to six postings a table. Two tables of lines under one parent may not share an id. |
| `into` | yes | `{ "addOn", "ledger", "action" }`. The add-on is one the manifest names under `addOns.requires` or `addOns.suggests` (or the add-on itself, in its own manifest). |
| `needs` | no | An app's [`addOns.features`](https://docs.adminium.dev/reference/manifest/#add-ons) id: the posting runs only while that feature is on. |
| `via` | no | A foreign key of this table: its rows are **lines** of the row the key names, and every point but a create is judged on that parent row. |
| `reserve`, `post`, `reverse` | one of the first two | `{ "on": <point> }`. `reverse` is required for an action that holds, and for an action that decides an amount when the row is created. |
| `map` | yes | An input of the action → where it is read: a column, `{ "row": true }` (the row itself), `{ "parent": "<column>" }` (under `via`), `{ "setting": "<column>" }` (the add-on's settings row), `{ "value": … }`. Every input the action needs is mapped, and nothing else. |
| `multipliers` | no | The same, for `night`, `guest` and `guest_night` (which is `night × guest` when not mapped). |
| `heldUntil` | with a `reserve` of an action that holds | A date-and-time column of the row, or `{ "parent": "<column>" }`. Nothing else: a hold ends at a moment a row keeps. |
| `unlessSet` | no | A column of the line: while it is filled, the line is left out of every call. |
| `only` | no | `{ "column", "eq" }`, `{ "column", "in": [...] }` or `{ "column", "set": true }`: only matching lines are handed over. |
| `refuses` | no | Up to four `{ "column", "set": true }` (a line of the same table) or `{ "table", "via", "column", "set": true }` (a line of another table under the same parent): the save is refused while such a line has the column filled. Under `via` only. |

A **point** is one of:

| Point | Fires |
|---|---|
| `{ "create": true }` | when the row is created (under `via`: when the line is). |
| `{ "to": [...], "from"?: [...] }` | when the row's [state](https://docs.adminium.dev/reference/manifest/#states) moves into one of `to` — from one of `from`, when given — or it is created in one. Needs `states` on the judged table. |
| `{ "column", "in": [...], "from"?: [...], "own"?: true }` | when a column takes one of the values. |
| `{ "column", "set": true, "own"?: true }` | when a nullable column is filled. |

`own` is said under `via`: the point is the line's own column, not the parent's.

A mapped column is the row's own to say. It may be a default, a formula, a stamp or a copy made
once; it may not be a total, a balance or a copy that follows another row, since Adminium settles
those in the same save. A column mapped to an input the action **decides** is written by Adminium
and by nobody else: it is not the key, the state column, a formula, a running number or a total.
