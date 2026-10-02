<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — A create with its child rows; do not edit -->

# Manifest spec: Public access — A create with its child rows

### A create with its child rows

A create may carry the rows that belong to it, two levels at most, in one write: an order, its
lines, and each line's options. `children` maps each child table to what the browser may send for
its rows.

```json
{ "table": "orders", "methods": ["POST"],
  "select": ["id", "number", "pickup_at", "subtotal", "tax", "total"],
  "writable": ["name", "email", "pickup_at", "note", "client_key"],
  "requires": ["name", "email"], "humanCheck": true,
  "children": {
    "order_items": {
      "via": "order_id", "writable": ["menu_item_id", "qty", "note"],
      "select": ["id", "qty", "unit_price", "line_total"],
      "requires": ["menu_item_id"], "position": "position", "min": 1, "max": 40,
      "plainText": ["note"],
      "sumMax": { "column": "qty", "max": { "table": "settings", "column": "max_items" } },
      "children": {
        "order_item_modifiers": {
          "via": "order_item_id", "writable": ["modifier_id"], "select": ["id", "name", "price"], "max": 20,
          "agrees": [{ "column": "modifier_id", "path": ["group_id", "item_id"], "eq": { "parent": "menu_item_id" } }],
          "counts": [{ "by": ["modifier_id", "group_id"],
                       "every": { "column": "item_id", "eq": { "parent": "menu_item_id" } },
                       "min": "min", "max": "max" }] } } } },
  "dryRun": true, "expect": "total", "clientKey": "client_key" }
```

Each child table, 1–4 at each level, takes:

| Field | Rule |
|---|---|
| `via` | The child's foreign key to the row it belongs to. |
| `writable` | The columns a child row may set. Never a column Adminium decides, nor a link to the people who sign in (Adminium fills it). |
| `select` | What the reply shows of each child row; without it, the child's key only. |
| `defaults`, `writableValues`, `requires` | As on the entry itself, for the child's rows. |
| `position` | A whole-number column Adminium numbers 1, 2, 3… in the order the rows were sent. |
| `min`, `max` | Rows per parent row: `max` 1–200, `min` no more than `max`. |
| `agrees` | 1–8 checks that tie a row's values to its parent or to what it points at (below). |
| `counts` | 1–2 limits on how many sibling rows fall in one group (below). |
| `plainText` | 1–8 writable `text` columns that hold plain text only, as a [guest's change](https://docs.adminium.dev/reference/manifest/#limits-on-a-guests-change) does: no digits, no web address and no `@` handle. A column may be `{ "column": "note", "digits": 4, "max": 140 }` instead: up to 4 digits in all, up to 200 characters. |
| `sumMax` | `{ "column", "max" }`: the most a number column may add up to across the rows of one write (a dozen items to an order), `max` a number or a whole-number setting. |
| `children` | One more level, the same shape without `children` of its own. |

An **agreement** is `{ "column", "path"?, "when"?, <one of "eq", "lte", "gte">: target }`: the row's
`column`, followed along `path` (1–3 foreign keys, the last naming the column compared), equals, is
at most or is at least the target. The target is `{ "parent", "path"? }`, a column of the row it
belongs to; `{ "via", "column" }`, a column of a row this row points at; or `{ "value" }`. `when`
(`{ "path"?, "in" }`) applies it only to rows whose value is one of `in`. On the entry itself,
`agrees` checks the created row's own values (guests no more than a room sleeps), with no `parent`
target. A root `agrees` is held on staff writes to the table too: creates and changes at the desk,
single, bulk or with links. An import is history, and is not held.

A **count** is `{ "by", "every"?, "min", "max" }`: `by` follows the row's foreign keys to its group
(an option's group), whose whole-number `min` and `max` columns bound how many sibling rows fall in
it. `every` (`{ "column", "eq": { "parent" } }`) names the groups judged even when no row falls in
them, those whose column equals the parent row's (a required size left out).

A guest's number that feeds a price Adminium works out (a line's `qty`) declares
`validation.min` (at least 0) and `validation.max`. A create anyone may make with child rows asks
the human check once, for the whole write. Everything is checked by Adminium, never trusted from
the browser, and the whole write is kept or nothing is. For the wire, see
[An order with its lines](https://docs.adminium.dev/guides/apps/orders-with-lines/).
