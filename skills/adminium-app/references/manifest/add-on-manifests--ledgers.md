<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — Ledgers; do not edit -->

# Manifest spec: Add-on manifests — Ledgers

### Ledgers

An add-on with tables of its own may keep up to four **ledgers** under `addOn.ledgers`: tables
whose rows it alone plans, written by Adminium inside the save of the row that
[posts](https://docs.adminium.dev/reference/manifest/#postings) into them.

```json
"ledgers": [
  {
    "id": "stock",
    "refusal": "stock",
    "receipts": "postings",
    "writes": {
      "movements": { "insert": ["level_id", "quantity", "kind"] },
      "reservations": { "insert": ["level_id", "quantity", "state"], "update": { "by": ["id"], "set": ["state"] } }
    },
    "actions": {
      "use": {
        "inputs": { "item": "link", "quantity": "decimal", "note": "text?" },
        "phases": ["reserve", "post", "reverse"],
        "reads": [
          { "as": "levels", "table": "levels", "by": [{ "column": "item_id", "from": "input.item" }] },
          { "as": "mine", "table": "reservations", "by": [{ "column": "receipt_id", "from": "receipt.id" }] }
        ],
        "locks": [{ "read": "levels", "column": "id", "table": "levels" }],
        "holds": true
      }
    }
  }
]
```

| Field | Rule |
|---|---|
| `id` | A lowercase name. |
| `refusal` | `stock` or `value`: which of the two public refusals a guest hears (`PUBLIC_OUT_OF_STOCK`, `PUBLIC_CARD_REFUSED`). |
| `receipts` | One of the add-on's tables, with exactly the [receipt columns](https://docs.adminium.dev/reference/manifest/#the-receipt-table). Adminium alone writes it. |
| `writes` | Up to twelve of the add-on's own tables, each with the columns an answer may `insert` and, by a key, `update`. Never a delete. Never a total, a balance, a formula, a stamp, a number, a code, a copy or the key. A table an answer inserts into carries `receipt_id`, a link to the receipt table that may be empty; Adminium fills it. Such a table carries no booking rule, no slot or night limit and no number without gaps. |
| `actions` | 1–16, by name. |

An **action**:

| Field | Rule |
|---|---|
| `inputs` | What a posting maps: each `link`, `number`, `decimal`, `text`, `date`, `bool` (with `?` when it may be empty), `tableRef` or `rowRef` (a row of any table: `{ "row": true }` in a posting for the row itself, or a link column for the row it points at). |
| `phases` | Which of `reserve`, `post`, `reverse` it has. |
| `reads` | Up to six `{ "as", "table", "by", "where"?, "limit"? }`: the rows Adminium reads for the code, from the add-on's own tables only. `by` is 1–3 `{ "column", "from" }`; `from` is `input.<name>`, `<an earlier read>.<column>`, `receipt.id`, `setting.<column>`, or a list of up to three of them. Up to 1,000 rows a read, 3,000 a call. |
| `locks` | 1–4 `{ "read", "column", "table" }`: the rows a save stands on. Two saves that would take from the same row wait for one another. Every table in `writes` that feeds a capped balance has that balance's table (or the table it stands for) here. |
| `writes` | Optional: the tables of the ledger this action writes, when not all of them. |
| `holds` | `true`: `reserve` writes something that ends. A posting into it says until when. |
| `decides` | `{ "input", "min": "0", "max": { "input" } \| { "read", "column" } }` entries: an amount Adminium writes to the posting row itself, between the bounds it reads. Two entries for one input are two ceilings. |
| `unavailable` | `{ "allow": { "read", "column" } }`: while the code cannot be asked, a save may still go through when every row of that read has the yes/no column on. It leaves a receipt to be worked out later. |

Three rules of the add-on's own tables are for ledgers:

- [`capUnless`](https://docs.adminium.dev/reference/manifest/#column-rules) on a capped total.
- `"announce": true` on a formula column (up to four a table): when a posting's settle changes it
  (an item that turns low), the change is told to automations, emails and open screens as a
  change of that row — though no one saved the row.
- `"planned": true` on a [state move](https://docs.adminium.dev/reference/manifest/#states): only a row the add-on's own code writes makes it.
  It is not offered to any person, effect or timed move.

#### The receipt table

One row a phase, written by Adminium: `id`, `source_table` and `line_table` (text, with
`"rules": { "tableRef": true }`), `source_row`, `source_line`, `ledger`, `action`, `posting` (text),
`phase` (`reserve`, `post`, `reverse`), `round` (a whole number), `state` (`planned`, `unplanned`),
`rows` (a whole number), `add_on_version`, `origin` (`staff`, `public`, `system`), `by` (text), `at`
(a date and time) and `held_until` (a date and time that may be empty). Adminium makes its unique
key and its indexes itself.

#### Code that decides

The add-on's package provides the contract `posting-rows`, version 1, as one self-contained
script. Adminium calls its `rows(input)` with the lines, the rows it read and the add-on's
settings, and writes what it answers. See
[A ledger, and code that decides](https://docs.adminium.dev/guides/add-ons-with-tables/#a-ledger-and-code-that-decides).
