<!-- produced from apps/docs/src/content/docs/guides/apps/orders-with-lines.md § Placing the order; do not edit -->

# An order with its lines: Placing the order

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
| `link` | The new row's own link, answered once, when the entry has one: see [a row's own link](https://docs.adminium.dev/reference/manifest/#a-rows-own-link). |
| `replayed` | `true` on a [retry](https://docs.adminium.dev/guides/apps/orders-with-lines/#retries) of an order already made. |

Nothing is written unless everything is: a refused line, a sold-out dish or a price that moved
leaves no order, no lines and no number taken.

### With the public client

[`@adminiumjs/public-client`](https://docs.adminium.dev/guides/public-api/endpoints-and-keys/) sends the same request and
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

`client.quote(ref, { values, children })` asks for a [quote](https://docs.adminium.dev/guides/apps/orders-with-lines/#the-price-first), and
`client.quoteChange(ref, id, values)` for a quote of a change to an existing row.
