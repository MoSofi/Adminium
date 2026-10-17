<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

| Field | Rule |
|---|---|
| `from` | The nullable `text` column of this row the code is typed into, up to 64 characters, with no rule of its own that decides it. |
| `table`, `column` | The codes table, and its `text` column the code is found by. The rule's own column is a nullable foreign key to `table`. `column` finds one row: it is `unique`, a [`code`](https://docs.adminium.dev/reference/manifest/#column-rules) column, or unique together with the `scope` columns in one of the table's [sets](https://docs.adminium.dev/reference/manifest/#columns-unique-together). It is compared as a code, so it has `normalize: "code"` unless it is a `code` column. Never the code a shared link opens its row with. |
| `where` | Up to 4 conditions on the codes row: `{ "column", "eq" }`; `{ "column", "notBefore": "now" or "today", "orEmpty"? }`, a date or time not yet past (`valid_until`); `{ "column", "notAfter": "now" or "today", "orEmpty"? }`, one already reached (`valid_from`). `orEmpty` lets an empty column pass. |
| `scope` | 1–2 `{ "column", "equals", "orEmpty"? }`: the codes row's `column` equals this row's `equals` column (this show's codes). With `orEmpty`, a codes row whose `column` is empty matches any (a code good for every show). |

A typed code is read the way codes are kept: upper case, spaces and dashes left out. A column
Adminium [makes codes in](https://docs.adminium.dev/reference/manifest/#column-rules) reads it as a claim does, its prefix put back, `O` as `0`,
`I` and `L` as `1`. Two stored codes that fold alike are told apart by the exact spelling.

Every miss is one answer: no such code, a code switched off, expired, another show's, or two that
fold alike are all refused `422` `VALIDATION_FAILED` on the typed column with the code `unknown`
(through the public API, `PUBLIC_WRITE_REFUSED` with `reason: "unknown"`), so a guesser learns no
more from one miss than from another. A code whose uses are all taken, counted by a
[parent limit](https://docs.adminium.dev/reference/manifest/#parent-limits) through the link, is refused on the typed column as `used-up`.
Emptying the typed column empties the link, and every copy made through it: a code taken off
takes its discount with it. A bulk edit, a form's child rows and an import find each row's code
the same way, and an unknown code refuses just that row. A table resolves at most two typed codes.

A code typed to **read** rows rather than write one (a presale code that shows its ticket type) is
a public entry's [`unlockBy`](https://docs.adminium.dev/reference/manifest/#codes-that-unlock-rows).

#### Codes that renew

A ticket's code is the door's proof. When the ticket goes to somebody else, the old code must
stop working at once, and the new holder gets one the old holder never saw. `code.renew` says
what makes a new code:

```json
{ "ref": "code", "type": "text", "nullable": true,
  "rules": { "code": { "length": 8, "renew": { "on": { "column": "holder_customer_id", "changed": true } } } } }
```

`on` is one trigger or a list of 2–3: `{ "column", "changed": true }`, any change of another
column of the row, or `{ "column", "values" }`, that column moving to one of 1–16 values (a
transfer accepted). The watched column is not a code itself, not `json` or `blob`, and a `changed`
trigger watches a column a person changes or a stamp writes (a holder stamped in as an offer is
taken renews too).

The new code is written in the same statement as the change: the old one stops as the write
commits, and every session a [token link](https://docs.adminium.dev/reference/manifest/#a-persons-own-rows) on that column opened stops with
it. What never renews: a create (it makes a code anyway), an import or other history, a change that
sends back the value the row already holds, and a server action that writes the code itself (a
[new link](https://docs.adminium.dev/reference/manifest/#a-rows-own-link)). A [timed move's](https://docs.adminium.dev/reference/manifest/#timed-moves) `set` renews like any other change.
Undoing a change of hands renews once more, so neither the old code nor the one handed on works
after it; see [Undo of a move](https://docs.adminium.dev/reference/manifest/#undo-of-a-move). A renewed code is never shown to a public caller
in the change's reply, and only to staff who may read the table.

#### Stamps

A stamp writes a value when a row is created, or when another column changes to one of a list of
values: the time a patient checked in, who took a payment.

```json
{ "ref": "checked_in_at", "type": "timestamptz", "nullable": true,
  "rules": { "stamp": { "set": "now", "on": { "column": "status", "values": ["checked_in"] } } } }
```

| Field | Rule |
|---|---|
| `set` | What is written; see the table below. |
| `on` | When: `"create"`; `{ "column", "values" }`, another column of the table and 1–16 values it must change to; `{ "column", "filled": true }`, the moment another column, a nullable one, is first filled; `{ "columns": [...] }`, whenever one of 1–8 other columns changes (a create sets them all); or a list of 2–3 of these, any of which writes the stamp. |
| `clearOnBack` | `true`: emptied again when a move marked [`undo`](https://docs.adminium.dev/reference/manifest/#undo-of-a-move) takes the row back out of a state the stamp watches (the time an order was marked ready, when the kitchen undoes the Ready). The column is nullable, the stamp watches the table's state column, and some `undo` move leaves one of the states it watches. |

What a stamp writes:
