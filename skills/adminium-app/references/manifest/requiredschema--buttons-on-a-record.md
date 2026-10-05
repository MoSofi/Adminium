<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Buttons on a record; do not edit -->

# Manifest spec: requiredSchema — Buttons on a record

### Buttons on a record

`states.actions` lists the buttons a generated record page offers on a row, in the app's own
words: up to 12, each with a kebab-case `id` and a `label` (one text, or one per language). A
manifest that uses it sets `compatibility.minAdminiumVersion` to `0.3.18` or later.

```json
"states": {
  "column": "status", "initial": "draft",
  "moves": { "draft": ["sent"], "sent": ["received"] },
  "actions": [
    { "id": "send", "label": "Send", "move": { "to": "sent" }, "tone": "primary",
      "confirm": "Send this order to the supplier?", "set": { "sent_at": { "now": true } } },
    { "id": "send-again", "label": "Send again", "set": { "resent_at": { "now": true } }, "in": ["sent"] },
    { "id": "receive", "label": "Receive", "link": { "page": "shop-receipts", "param": "order" }, "in": ["sent"] },
    { "id": "note", "label": "Add a note", "in": ["sent", "received"],
      "child": { "table": "order_notes", "via": "order_id", "form": ["text"] }, "set": { "kind": "desk" } }
  ]
}
```

An action is one of four forms:

| Form | Keys | What the button does |
|---|---|---|
| A move | `move: { "to" }`, `set`?, `ask`?, `confirm`? | Moves the row to the state. It is offered in every state that lists a move there. |
| A write | `set`, `in`, `ask`?, `confirm`? | Writes columns and moves nothing. |
| A link | `link: { "page" \| "addOnPage", "param" }`, `in` | Opens another page with the row's key as `param`. `page` is a page of the manifest; `addOnPage` is `<ref>` (a page of the same add-on) or `<add-on key>:<ref>`. |
| A child row | `child: { "table", "via", "form" }`, `set`?, `in`, `confirm`? | Opens a small form (up to 6 columns) and adds a row of the child table, linked through `via`. |

`in` lists the states the button is shown in. `tone` is `primary`, `neutral` (the default) or
`danger`. `ask` names up to 4 columns typed in the confirm before the action is made. `set` is
always a key of the action itself: on a move or a write it names columns of the row, on a child
row it names columns of the new row. A value is a text, a number or a yes/no the column takes, or
`{ "now": true }` on a `timestamptz` column of the row: the moment the action is made.

Checked against the manifest:

- A move goes to a state some listed move reaches by hand. A state only a `planned` move reaches
  has no button.
- A column the action sets or asks for is the row's to write: not the state column, not the key,
  not a column Adminium fills. A column kept from staff is never asked for.
- Where the table is [locked](https://docs.adminium.dev/reference/manifest/#states) in a state the button is shown in, or moves to, each column
  it writes is listed in `lock.except`.
- A child row's table has a foreign key `via` to this table. `via` is neither typed nor set.
- A column is set or typed, not both.
