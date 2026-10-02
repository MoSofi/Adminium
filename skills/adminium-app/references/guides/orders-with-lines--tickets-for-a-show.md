<!-- produced from apps/docs/src/content/docs/guides/apps/orders-with-lines.md § Tickets for a show; do not edit -->

# An order with its lines: Tickets for a show

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
of that type. See [parent limits](https://docs.adminium.dev/reference/manifest/#parent-limits).
