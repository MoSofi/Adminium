---
title: An order with its lines
description: How a guest's page places an order with its lines and each line's options in one write, shows the price before the guest pays, checks it on the save, and retries without making a second order; with tickets and a stay's extras.
---

A guest ordering lunch for pickup does not make one row. They make an **order**, two or three
**lines** (two burgers, one fries), and on each line the **options** they picked (cheese, no
onion, large). The kitchen must see all of it or none of it: an order that arrives without its
lines, or a line without its options, is worse than no order.

An app's create entry can therefore carry the rows that belong to the created row, two levels
down, in **one write**. Adminium checks every row, works out every price, takes every place a
limit counts, and commits the whole order or refuses the whole order. The same entry can also
answer a **quote** first (every figure, nothing kept), refuse a save whose total is not the one
the guest was shown, and answer a retried save with the order the first try already made.

This page follows a pickup kitchen. Tickets for a show and a hotel stay with its extras work the
same way; each has a short section [at the end](#tickets-for-a-show). The fields are in the
manifest reference, under [a create with its child rows](/reference/manifest/#a-create-with-its-child-rows)
and [dry runs, price checks and retries](/reference/manifest/#dry-runs-price-checks-and-retries).

## The tables

The kitchen keeps three tables for an order, and reads three for its menu:

| Table | What a row is | Figures Adminium works out |
|---|---|---|
| `orders` | One order: name, address, pickup time, note | `subtotal` (the lines added up), `tax`, `total`; `number`, a running number without gaps |
| `order_items` | One line: a dish, a quantity, a spice level, a note | `unit_price` (copied from the dish), `options_total` (its options added up), `line_total` |
| `order_item_modifiers` | One option on a line: cheese, large | `name` and `price`, copied from the option |
| `menu_items`, `modifier_groups`, `modifiers` | The menu: dishes, groups of options (size, extras) with a least and a most, and the options | none |

The page never sends a price. It sends which dish, how many, and which options. Adminium copies
each price from the menu row at the moment of the write, adds up the options, multiplies by the
quantity, adds the lines, and works out the tax and the total. A guest who edits the page's code
still pays the menu's prices.

The figures are ordinary [column rules](/reference/manifest/#column-rules):

```json
{ "ref": "unit_price", "type": "decimal", "scale": "currency", "nullable": true,
  "rules": { "copy": { "via": "menu_item_id", "from": "price" } } }
```

```json
{ "ref": "line_total", "type": "decimal", "scale": "currency", "nullable": true,
  "rules": { "formula": { "mul": ["qty", { "add": ["unit_price", { "coalesce": ["options_total", 0] }] }] } } }
```

```json
{ "ref": "total", "type": "decimal", "scale": "currency", "nullable": true,
  "rules": { "formula": { "add": ["subtotal", { "coalesce": ["tax", 0] }] } } }
```

The order also has a column for the page's retry key ([below](#retries)):

```json
{ "ref": "client_key", "type": "text", "maxLength": 64, "nullable": true, "unique": true }
```

## The create entry

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
`modifiers`. Those reads matter to the order: see [what a line may point at](#what-a-line-may-point-at).

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
| `plainText` | Text columns that hold plain text only: letters, spaces, ordinary punctuation, at most 80 characters, and no link, handle or web address. A note to the kitchen reaches a screen the staff read. |
| `sumMax` | The most one column may add up to across the rows of one write: no more than twelve items in an order. `max` is a number or a whole-number column of the settings row, so the venue changes it without an update. |
| `agrees`, `counts` | Checks that tie rows to each other ([below](#checks-that-tie-the-rows-together)). |

No table appears twice in one write, and the table of the people who sign in is never a child
row. Below one create, 200 rows in all are the most, whatever each list allows.

A child create that anyone may make without signing in asks for the [human check](#the-human-check),
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
room type sleeps ([below](#a-stay-and-its-extras)).

### What a line may point at

Every row a guest's value points at must be a row that some read of the same key shows them. A
dish the kitchen marked unavailable is not on the menu read, so a line naming its key is refused
`not-offered`, exactly like a key that does not exist. The same holds for an option, a ticket type
sold only at the box office, or a room type not offered online.

## Placing the order

The page sends the order's values and its rows, nested as the entry declares them, in one
request:

```bash
curl -X POST 'https://admin.example.com/api/v1/public/records/kitchen_orders' \
  -H "Authorization: Bearer $ADMINIUM_KEY" \
  -H 'Content-Type: application/json' \
  -H 'x-adminium-proof: <id>.<nonce>' \
  -d '{
    "values": {
      "name": "Ana Lima",
      "email": "ana@example.com",
      "pickup_at": "2026-10-02T12:30:00Z",
      "client_key": "q3v5c1Q0yJx0F8m2m4Zb3wYt9Ck7Rr1uP6oN2eL8aSd"
    },
    "children": {
      "order_items": [
        { "values": { "menu_item_id": 4, "qty": 2, "spice": "medium" },
          "children": { "order_item_modifiers": [ { "values": { "modifier_id": 11 } } ] } },
        { "values": { "menu_item_id": 9, "qty": 1 } }
      ]
    },
    "expect": { "total": "34.10" }
  }'
```

The ref in the path is the endpoint's: the real table name, `kitchen_orders` for an app keyed
`kitchen` with prefixed tables. The names under `children` are the manifest's short refs.

A new order answers `201`:

```json
{
  "data": { "id": 5120, "number": 318, "pickup_at": "2026-10-02T12:30:00Z", "subtotal": "31.50", "tax": "2.60", "total": "34.10" },
  "children": {
    "order_items": [
      { "data": { "id": 9001, "qty": 2, "unit_price": "12.50", "line_total": "27.00" },
        "children": { "order_item_modifiers": [ { "data": { "id": 7001, "name": "Cheese", "price": "1.00" } } ] } },
      { "data": { "id": 9002, "qty": 1, "unit_price": "4.50", "line_total": "4.50" } }
    ]
  }
}
```

| Field | What it holds |
|---|---|
| `data` | The order, as the entry's `select` shows it. |
| `children` | Each row written below it, in the order sent, as each level's `select` shows it. |
| `rank` | Where the new row stands among the matching rows (a place in a queue), when the entry ranks. |
| `link` | The new row's own link, answered once, when the entry has one: see [a row's own link](/reference/manifest/#a-rows-own-link). |
| `replayed` | `true` on a [retry](#retries) of an order already made. |

Nothing is written unless everything is: a refused line, a sold-out dish or a price that moved
leaves no order, no lines and no number taken.

### With the public client

[`@adminiumjs/public-client`](/guides/public-api/endpoints-and-keys/) sends the same request and
solves the human check for you:

```ts
import { newClientKey, PublicApiError } from '@adminiumjs/public-client';

const clientKey = newClientKey(); // once per cart, kept until the order is made

const order = await client.createTree('kitchen_orders', {
  values: { name, email, pickup_at: pickupAt, client_key: clientKey },
  children: { order_items: lines },
  expect: { total: quote.data.total },
});
// order.data, order.children, order.rank, order.replayed, order.link
```

`client.quote(ref, { values, children })` asks for a [quote](#the-price-first), and
`client.quoteChange(ref, id, values)` for a quote of a change to an existing row.

## The price first

A guest should see what the order comes to before they pay. With `"dryRun": true` on the entry,
the page can send the same body to the quote route:

```bash
curl -X POST 'https://admin.example.com/api/v1/public/records/kitchen_orders/dry-run' \
  -H "Authorization: Bearer $ADMINIUM_KEY" \
  -H 'Content-Type: application/json' \
  -d '{ "values": { "pickup_at": "2026-10-02T12:30:00Z" }, "children": { "order_items": [ … ] } }'
```

```json
{
  "data": { "pickup_at": "2026-10-02T12:30:00Z", "subtotal": "31.50", "tax": "2.60", "total": "34.10" },
  "children": { "order_items": [ … ] },
  "capacity": [ { "pool": "…", "state": "available" } ],
  "exact": true
}
```

A quote runs the save's own steps in a transaction that is always rolled back:

- **Every figure.** Each line's price, the options, the tax, the total: whatever Adminium works out
  for the rows. A stay priced by the night also answers `nights`, one entry per night with its
  `date`, its `rate`, its `base` rate before anything was added, and the `tags` of what was added
  (a weekend rate).
- **No keys, no numbers.** A quote shows no row key, no running number (the next number would tell
  how many orders were made), no code and no retry key.
- **Before the details.** The name and address a guest has not typed yet are filled in for the
  quote alone and shown empty, so the cart can be priced first. Only a column the price does not
  read is filled in.
- **Nothing kept, nothing held.** A quote takes no lock, claims no number, makes no person, sends
  nothing and holds no place. It reads the rows it judges as they are.
- **Never charged.** A quote does not count against the entry's [caps](#limits-on-a-strangers-order),
  and needs no human check. It costs a read, not a write.
- **Refused as the save would be.** A dish not on the menu, a size left out, a sold-out line, a
  name with a link in it: the quote gets the refusal the save would get, so the page can say so
  before the guest pays.
- **Holds let go as the save would.** Where a checkout holds places for a while
  ([holds](/reference/manifest/#holds)), a page that sends its old hold's session as `replaces`
  gets a quote that counts that hold as let go, as the save would. Nothing is let go by the quote.
- **`capacity`** lists each limit the order takes from and whether it is `available` or `full`.
- **`exact`** is `false` when the app runs its own code before a create on one of the tables. A
  quote runs none, so the save may come to another figure.

A quote refuses when online orders are switched off, like the save.

## The price check

The guest saw 34.10. Between the quote and the save, the kitchen raised the price of fries. The
guest must not pay a price they did not see.

With `"expect": "total"` on the entry, the save may send the total the guest was shown:

```json
{ "expect": { "total": "34.10" } }
```

Adminium writes the whole order, works out the total, and compares it at the column's own places.
If it is different, nothing is written, and the save is refused `409` `PUBLIC_PRICE_CHANGED`, with
`params.total` (the figure it came to) and `params.lines` (every row below it, shaped like the
reply's `children`). The page shows the new price and asks again. The same retry key can be sent
with the new total, since nothing was made.

The column named must be a money column that Adminium works out, and the entry must show it in
`select`. A save that sends `expect` to an entry that checks no price is refused `400`
`PUBLIC_WRITE_REFUSED`. A change to a row can carry `expect` too, on an entry that changes rows.

## Retries

A guest presses **Pay**, the network drops, and the page never hears back. Did the order go in?
Pressing again must not make a second order.

The page mints a **retry key** for the cart and sends it in the column the entry names as
`clientKey`. A second save with the same key finds the order the first one made and answers it,
`200`, with `replayed: true`, instead of making another:

```json
{ "data": { … }, "children": { … }, "replayed": true }
```

- **Mint it in the browser, once per cart.** `newClientKey()` returns 32 random bytes as 43
  characters of base64url. The server takes 22 to 64 letters, digits, `-` or `_`, and refuses
  anything else `400` `PUBLIC_WRITE_REFUSED` with the column and `reason: "format"`. Never use a
  cart's id: whoever holds the key gets the order back.
- **Keep it until the order is made,** then mint a new one for the next order. A refused save made
  nothing, so its key can be sent again.
- **A replay shows the rows as they are now,** read as the person who made the order. It has no
  `link` and no `rank`: the confirmation email carries the link.
- **It still answers after online orders are switched off.** A retry of an order that went in
  before the switch is replayed; anything new is refused `403` `PUBLIC_SWITCHED_OFF`.
- **A replay is not charged** against the caps. It is still a request: it solves a new human
  check, which the client does for you.

The column is a text column, unique, with room for at least 43 characters: Adminium keeps a keyed
hash of the key, never the key itself, so staff, exports and emails that read the table learn
nothing a retry could be made with. It must be writable on the entry, and no entry of the app may
show it, filter by it or sort by it. Only a single create keeps one: a batch never does, nor a row
created through its parent.

## What a guest is told

| Code | Status | When |
|---|---|---|
| `PUBLIC_WRITE_REFUSED` | 400 | A row or value was refused. `child`, `index` and `path` name the row (`path` is its whole place, such as `["order_items", 1, "order_item_modifiers", 0]`); `column` and `reason` name the value, where the guest may be told. A list the entry does not offer, or with too many or too few rows, names the list with `reason` `not-offered`, `too-many` or `too-few`. |
| `PUBLIC_SOLD_OUT` | 409 | A line takes from a limit that is full: a dish's portions, a ticket type. `child`, `index`, `path` and `column` name the line and the column the limit counts by. |
| `PUBLIC_SLOT_FULL` | 409 | The order's time slot is full. |
| `PUBLIC_NO_ROOM` | 409 | A stay's room type has no room on a night; `night` names it. |
| `PUBLIC_SLOT_BUSY` | 409 | Another write held the same places at that instant. Nothing was written. Send the same save again, with the same retry key. |
| `PUBLIC_PRICE_CHANGED` | 409 | The total is not the one expected; `total` and `lines` say what it came to. Nothing was written. |
| `PUBLIC_LIMIT_REACHED` | 409 | A cap on a stranger's order is spent ([below](#limits-on-a-strangers-order)). |
| `PUBLIC_PROOF_REQUIRED` | 403 | The human check is missing, wrong or used. |
| `PUBLIC_SWITCHED_OFF` | 403 | Online orders are switched off, and this is not a retry of an order already made. |

The public client reads these for you: `error.refused` (`child`, `index`, `path`, `column`,
`reason`, `group`), `error.soldOut` (`child`, `index`, `path`, `column`), `error.priceChanged`
(`total`, `lines`), and `error.isTransient`, which is true for `PUBLIC_SLOT_BUSY`. Each getter is
`null` on any other code. Every code is listed in the [errors reference](/reference/errors/).

## Limits on a stranger's order

### Capacity counts every row

The order's rows are judged against the app's limits once, over every row the write makes. A line
of three burgers takes three from the day's burgers, a pickup slot takes the order, a ticket takes
its place in its ticket type. A limit on a child table counts the child rows exactly as it counts
rows made one at a time. See [booking rules](/guides/apps/booking-rules/) and the manifest's
[capacity](/reference/manifest/#capacity) for how limits are declared.

### Caps on a stranger

`anonymous` caps an order that nobody signed in for, as on any
[stranger's create](/guides/apps/public-access/#limits-on-a-strangers-create):

- **`perValue`**: at most so many a day for one value of the named columns (one address).
- **`perKeyHour`**: at most so many an hour through the key, from everyone.
- **`perIpHour`**: at most so many an hour from one visitor through this entry, 1 to 60. A visitor
  is one address, or an IPv6 subscriber's whole /64. Every visitor is also held to 60 an hour on
  the key, so this only ever lowers it.
- **`plainText`**: the order's own columns that hold plain text only, judged as a line's
  `plainText` is: no link, handle or web address.

Every cap is charged just before the rows are written. An order
refused for a guest's own value (a note too long, an address that is not one) gives the charge
back. Any other refusal of the whole order keeps it: a sold-out line, a busy slot, a moved price,
an option of the wrong dish. A quote is never charged, and a replay is not either.

### The human check

A create with its child rows asks for one proof for the whole write, not one per row. See
[the human check](/guides/apps/public-access/#the-human-check).

## Tickets for a show

An order of tickets is an order whose lines are tickets. The order names the show; each ticket
names its type and its holder, and must be a type of that show:

```json
{
  "children": {
    "tickets": {
      "via": "order_id",
      "writable": ["ticket_type_id", "holder_name"],
      "select": ["id", "price"],
      "min": 1,
      "max": 12,
      "plainText": ["holder_name"],
      "agrees": [{ "column": "ticket_type_id", "path": ["event_id"], "eq": { "parent": "event_id" } }]
    }
  }
}
```

Each ticket type has a number of places, a limit on the tickets table:

```json
{ "capacity": { "kind": "parent", "via": "ticket_type_id", "size": { "column": "capacity" } } }
```

Six tickets for a type with four places left are refused `409` `PUBLIC_SOLD_OUT`, naming a ticket
of that type. See [parent limits](/reference/manifest/#parent-limits).

## A stay and its extras

A hotel booking is a stay with extras (breakfast, parking) as its child rows. The stay's price is
worked out by the night, and its own `agrees` holds the guests to what the room sleeps:

```json
{
  "agrees": [{ "column": "guests", "lte": { "via": "room_type_id", "column": "sleeps" } }],
  "children": { "stay_extras": { "via": "stay_id", "writable": ["extra_id"], "max": 10 } }
}
```

A quote of a stay answers its `nights`, so the page can show each night's rate and a weekend's
raise beside the total. A guest who later changes their dates asks `client.quoteChange` for the
new total first, then saves the change with `expect`. See
[prices by the night](/reference/manifest/#prices-by-the-night).

## At the desk

Staff place the same order through the data API, and it runs the same way: `children` with the
record, a quote at `POST /api/v1/data/{connectionId}/{table}/dry-run`, `expect` (a save at another
total is refused `409` `PRICE_CHANGED`) and `clientKey` (a retry answers `200` with
`replayed: true`). A desk's retry key is its own: kept per user, in the column the app's public
entries keep a guest's in. A table with no such column refuses one. The desk is held to the same
`agrees`, `counts` and `sumMax` as a guest, but not to the menu's public reads: it may pick any
dish its role can read. See the
[REST API](/reference/rest-api/).
