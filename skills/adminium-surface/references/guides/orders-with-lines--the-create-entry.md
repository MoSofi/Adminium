<!-- produced from apps/docs/src/content/docs/guides/apps/orders-with-lines.md § The create entry; do not edit -->

# An order with its lines: The create entry

The order is created through one public entry. Its `children` name the lines, and the lines'
`children` name the options:

```json
{
  "table": "orders",
  "methods": ["POST"],
  "select": ["id", "number", "pickup_at", "subtotal", "tax", "total"],
  "writable": ["name", "email", "pickup_at", "note", "client_key"],
  "requires": ["name", "email"],
  "humanCheck": true,
  "anonymous": {
    "perValue": { "columns": ["email"], "n": 10 },
    "perKeyHour": 300,
    "perIpHour": 20,
    "plainText": ["name"]
  },
  "children": {
    "order_items": {
      "via": "order_id",
      "writable": ["menu_item_id", "qty", "spice", "note"],
      "select": ["id", "qty", "unit_price", "line_total"],
      "defaults": { "course": "now" },
      "writableValues": { "spice": ["mild", "medium", "hot"] },
      "requires": ["menu_item_id"],
      "position": "position",
      "min": 1,
      "max": 40,
      "plainText": ["note"],
      "sumMax": { "column": "qty", "max": { "table": "settings", "column": "max_items" } },
      "children": {
        "order_item_modifiers": {
          "via": "order_item_id",
          "writable": ["modifier_id"],
          "select": ["id", "name", "price"],
          "max": 20,
          "agrees": [
            { "column": "modifier_id", "path": ["group_id", "item_id"], "eq": { "parent": "menu_item_id" } }
          ],
          "counts": [
            { "by": ["modifier_id", "group_id"], "every": { "column": "item_id", "eq": { "parent": "menu_item_id" } }, "min": "min", "max": "max" }
          ]
        }
      }
    }
  },
  "dryRun": true,
  "expect": "total",
  "clientKey": "client_key"
}
```

The same app also declares reads of `menu_items` (only those `available`), `modifier_groups` and
`modifiers`. Those reads matter to the order: see [what a line may point at](https://docs.adminium.dev/guides/apps/orders-with-lines/#what-a-line-may-point-at).

### Each level of child rows

Each key under `children` is a table of the app, by its short ref. The rows go two levels below
the create at most: an order, its lines, each line's options. Each level names one to four
tables.

| Field | Rule |
|---|---|
| `via` | The child's foreign key to the row above it. Adminium fills it; the page never sends it. |
| `writable` | The columns the page may send for each row. Never a figure Adminium works out, never `via`, the `position` or the table's state, and never a link to the people who sign in. |
| `select` | What the reply shows of each row. Without it, the row's key only. |
| `defaults` | Values Adminium sets on every row, which the page cannot change: every line starts in the kitchen's `now` course. |
| `writableValues` | The only values the page may send for a column. Here a guest picks mild, medium or hot; extra-hot is the counter's to give. |
| `requires` | Columns each row must fill. They must be writable. A line with no dish is refused with `reason: "required"`. |
| `position` | A whole-number column Adminium numbers 1, 2, 3 in the order the rows were sent, so the kitchen's ticket lists the lines as the guest built them. |
| `min`, `max` | How many rows per row above. `max` is 1 to 200. A cart with no lines is refused with `min: 1`. |
| `plainText` | Text columns that hold plain text only: letters, spaces, sentence punctuation (Latin, CJK and Arabic), at most 80 characters, and no link, handle or web address. A note to the kitchen reaches a screen the staff read. A note may take a few digits and more characters: `{ "column": "note", "digits": 4, "max": 140 }` ([Plain text](https://docs.adminium.dev/guides/apps/identity-and-own-links/#plain-text)). |
| `sumMax` | The most one column may add up to across the rows of one write: no more than twelve items in an order. `max` is a number or a whole-number column of the settings row, so the venue changes it without an update. |
| `agrees`, `counts` | Checks that tie rows to each other ([below](https://docs.adminium.dev/guides/apps/orders-with-lines/#checks-that-tie-the-rows-together)). |

No table appears twice in one write, and the table of the people who sign in is never a child
row. Below one create, 200 rows in all are the most through the public API, whatever each list
allows; a staff save takes up to 1,000 (a message with an email for each of a show's buyers).

A child create that anyone may make without signing in asks for the [human check](https://docs.adminium.dev/guides/apps/orders-with-lines/#the-human-check),
once for the whole write. The manifest check refuses an entry with `children` that anyone may use
and no `humanCheck`.

### Checks that tie the rows together

A menu has rules the page's buttons follow, and the write follows them too, whatever the page
sends:

- **`agrees`** compares a row's value with another. `column`, followed along `path` through
  foreign keys, must equal (`eq`), be at most (`lte`) or be at least (`gte`) one target: a column
  of the row above (`parent`, followed along its own `path`), a column of a row this row points at
  (`via` and `column`), or a fixed `value`. Each agreement says exactly one of `eq`, `lte` and
  `gte`. `when` applies it only to rows whose value (along its own `path`) is one of `in`. Here an
  option's group must belong to the line's dish: cheese is an option of the burger, and a guest
  cannot put it on the fries.
- **`counts`** counts the sibling rows in each group: the options of one line by their group
  (`by` follows the option to its group), between the group's own `min` and `max` columns. `every`
  names the groups judged even when no row falls in them, here every group of the line's dish: a
  burger whose size group has a least of 1 is refused if the guest picked no size.
- **`sumMax`**, above, bounds a whole list.

A refusal names the row: `400` `PUBLIC_WRITE_REFUSED` with `child`, `index` and `path`, the
`column`, and a `reason` of `not-offered` (an option of another dish), `too-many` or `too-few`.
A count that fails names its `group` instead of a column; a sum over a list names the list and the
column.

### Checks on the order itself

The create entry can carry `agrees` of its own, on the created row's values. They cannot name a
`parent`, since the order has none. The hotel's stay uses one: the guests may be no more than the
room type sleeps ([below](https://docs.adminium.dev/guides/apps/orders-with-lines/#a-stay-and-its-extras)).

### What a line may point at

Every row a guest's value points at must be a row that some read of the same key shows them. A
dish the kitchen marked unavailable is not on the menu read, so a line naming its key is refused
`not-offered`, exactly like a key that does not exist. The same holds for an option, a ticket type
sold only at the box office, or a room type not offered online.
