<!-- produced from apps/docs/src/content/docs/guides/apps/orders-with-lines.md § A stay and its extras; do not edit -->

# An order with its lines: A stay and its extras

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
[prices by the night](https://docs.adminium.dev/reference/manifest/#prices-by-the-night).
