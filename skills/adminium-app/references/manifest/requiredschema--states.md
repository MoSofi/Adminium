<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — States; do not edit -->

# Manifest spec: requiredSchema — States

### States

`states` describes the life of a row: the states it moves through, what may happen in each, and
the child tables tied to them. An invoice is a draft, then sent, then perhaps void; once sent, its
lines are locked and payments may be recorded against it.

```json
"states": {
  "column": "status", "initial": "draft",
  "moves": {
    "draft": [{ "to": "sent", "requires": { "children": { "invoice_lines": 1 },
                                            "where": [{ "column": "total", "gt": 0 }] } }, "void"],
    "sent":  [{ "to": "void", "requires": { "where": [{ "column": "paid", "eq": 0 }] },
                "roles": ["manager"] }]
  },
  "lock": { "when": ["sent", "void"], "except": ["due_on", "ladder", "void_reason"] },
  "children": {
    "invoice_lines": { "via": "document_id", "lock": true },
    "payments": { "via": "document_id", "parentIn": ["sent"], "clearOnCreate": ["client_paid_at"] }
  },
  "noDelete": { "when": "numbered" }
}
```

| Field | Required | Rule |
|---|---|---|
| `column` | yes | The `enum` column that holds the state. Every state named below is one of its values. |
| `initial` | yes | The state a new row starts in. |
| `moves` | yes | From each state, up to 16 states a row may move to. A move is a state (`"void"`), or `{ "to", "requires"?, "roles"?, "undo"?, "clears"? }`. A move goes to another state. `undo: true` marks a move that takes back the listed move the other way; `clears` (1–8 columns, on an undo only) names further columns it empties. See [Undo of a move](https://docs.adminium.dev/reference/manifest/#undo-of-a-move). |
| `lock` | no | `{ "when", "except"? }`. While a row is in one of `when` (1–16 states), only the columns in `except` (up to 32) may change, and the state itself through a move. The state column is never in `except`. |
| `children` | no | Child tables tied to the row's state, keyed by table ref. See below. |
| `lockedWhenReferencedBy` | no | 1–4 `{ "table", "via", "in" }`: the row is locked once a row of `table`, whose foreign key `via` points at it, is in one of the states `in` (a terms version, once a proposal naming it is sent). Needs `lock`, which says what stays open. |
| `noDelete` | no | `{ "when" }`: rows that are never deleted, only voided. `when` is 1–16 states, or `"numbered"`: any row that holds a number from a [gapless sequence](https://docs.adminium.dev/reference/manifest/#numbers-without-gaps). `"numbered"` needs such a column on the table. |
| `onlyLater` | no | 1–8 `date` or `timestamptz` columns that may move later, never earlier (a quote's `valid_until`). An entry `{ "column": "depart", "in": ["in_house"] }` holds only while the row is in one of `in` (a stay in the house leaves no earlier by a change of its date). |
| `strict` | no | `true`, or `{ "show": [1–4 columns] }`: a write naming the state the row already holds is refused rather than passing silently (a ticket let in once). See [Once means once](https://docs.adminium.dev/reference/manifest/#once-means-once). |
| `late` | no | 1–4 moves judged late when made close to a moment; see [Late moves](https://docs.adminium.dev/reference/manifest/#late-moves). |
| `timed` | no | 1–8 moves Adminium makes by itself once a moment has passed; see [Timed moves](https://docs.adminium.dev/reference/manifest/#timed-moves). |
| `effects` | no | 1–8 moves of the row a link points at, set off by this row's move or by a change of the link; see [Effects](https://docs.adminium.dev/reference/manifest/#effects). |
| `create` | no | `{ "requires" }`: what a new row must meet to be created; see [Conditions on a new row](https://docs.adminium.dev/reference/manifest/#conditions-on-a-new-row). |

A move's `requires` says what must be true first:

| Field | Rule |
|---|---|
| `children` | `{ "<table>": n }`: at least `n` (1–1000) rows of a child table. The table must be one of `children`. |
| `where` | 1–8 conditions on the row itself: `{ "column", <one test> }`, where the test is `eq` or `in` (values that fit the column), `isNull` (`true` or `false`), or `gt`, `gte`, `lt` or `lte` (a number, on a number column). |
| `linked` | 1–4 `{ "via", "where" }`: conditions (as `where`) on the row this row's foreign key `via` points at (the order a ticket belongs to is paid). |
| `time` | `{ "after"?, "before"? }`: a window on the clock, each end a [moment](https://docs.adminium.dev/reference/manifest/#moments) (from half an hour before the doors, until the ticket's day ends). |
| `setting` | 1–4 `{ "table", "column", "eq" }`: a value of the settings row (door sales switched on). |

A move's `roles` (1–8 of the app's [role](https://docs.adminium.dev/reference/manifest/#roles) keys) keeps it for the people holding one of
them: any role may void a draft, only a manager a sent invoice.

Each entry of `children` names a child table whose foreign key `via` points at this table, with at
least one of:

| Field | Rule |
|---|---|
| `lock` | `true`: the child's rows are locked while this row is. Needs a `lock` on this table. |
| `parentIn` | 1–16 states: the child's rows may be written only while this row is in one of them (payments on a sent invoice). Not with `lock`. It is `createIn` and `changeIn` at once. |
| `createIn` | 1–16 states: a child row may be **added** only while this row is in one of them (a payment taken on a stay still booked or in house). Not with `lock` or `parentIn`. |
| `changeIn` | 1–16 states: a child row may be **changed or deleted** only while this row is in one of them (a payment voided on a cancelled stay too). Not with `lock` or `parentIn`. |
| `clearOnCreate` | 1–8 nullable columns of **this** row, emptied when a child row is created (a recorded payment clears the client's "I've sent it"). |
| `lockLinked` | `{ "<link>": ["<column>", …] }`: for 1–8 of the child's foreign keys to other tables, 1–16 columns of the row the link points at that do not change while a child row points at it (the hours of time an invoice line bills). The key is never one. |

and, with `lock`:

| Field | Rule |
|---|---|
| `release` | `{ "when", "columns" }`: while this row is in one of `when` (states the `lock` holds, and that no move leaves), a child row may still **empty** the listed columns (1–8 nullable columns of the child, never `via` or the key), and change nothing else. A released state must be final: a released link stops locking the row it points at, so a document that could move on would bring its line back billing a row that changed meanwhile. |

Time and purchases billed on invoice lines, so that nothing is billed twice (each link `unique`),
and billed again once the invoice is void:

```json
"children": {
  "invoice_lines": {
    "via": "invoice_id", "lock": true,
    "release": { "when": ["void"], "columns": ["time_entry_id", "expense_id"] },
    "lockLinked": {
      "time_entry_id": ["hours", "logged_hours", "project_id", "date"],
      "expense_id": ["amount", "currency", "project_id", "client_id"]
    }
  }
}
```
