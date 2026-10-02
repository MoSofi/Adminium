<!-- produced from apps/docs/src/content/docs/reference/errors.md § Public API codes — Full, sold out, no room; do not edit -->

# Error codes: Public API codes — Full, sold out, no room

### Full, sold out, no room

A limit that has no room left answers by what it counts, and names the column the guest chose it
by, never how many are left or who took them:

| Limit | Code | params |
|---|---|---|
| A [slot limit](https://docs.adminium.dev/reference/manifest/#slot-limits): a pickup time, a table at 19:30 | `409` `PUBLIC_SLOT_FULL` | `column`, the time column. A table whose limit is the single slot rule of the original form (no `kind`, an `amount` column, one condition on the row) answers with no params. |
| A [booking rule](https://docs.adminium.dev/guides/apps/booking-rules/): the time went while the guest was choosing | `409` `PUBLIC_SLOT_FULL` | none |
| A [parent limit](https://docs.adminium.dev/reference/manifest/#parent-limits): tickets of a type, today's portions of a dish | `409` `PUBLIC_SOLD_OUT` | `column`, the line's link to what ran out (`ticket_type_id`) |
| A [night limit](https://docs.adminium.dev/reference/manifest/#night-limits): rooms of a type | `409` `PUBLIC_NO_ROOM` | `column`, and `night`, a night of the stay with no room (`2026-12-24`) |

On a create with child rows, a refusal about a child row adds its place: `child` (the list's
name), `index` (its place in the list) and `path` (the whole way down, such as
`["order_items", 3, "order_item_modifiers", 0]`):

```json
{ "error": { "code": "PUBLIC_SOLD_OUT", "message": "That is sold out.",
  "params": { "child": "tickets", "index": 1, "path": ["tickets", 1], "column": "ticket_type_id" } } }
```

A limit that counts the uses of a [typed code](https://docs.adminium.dev/reference/manifest/#typed-codes) is not "sold out"
for a guest: a code whose uses are all taken answers `PUBLIC_WRITE_REFUSED` with the reason
`used-up` on the column the code was typed into.
