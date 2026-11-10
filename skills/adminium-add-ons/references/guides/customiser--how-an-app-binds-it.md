<!-- produced from apps/docs/src/content/docs/guides/add-ons/customiser.md § How an app binds it; do not edit -->

# The Customiser add-on: How an app binds it

The app binds the Customiser from its own side; the add-on never names a table of the app. Maker
Shop and Print Shop do it with four links ([`addOnLink`](https://docs.adminium.dev/reference/manifest/#column-rules)):

| Column | Links into | What it is for |
|---|---|---|
| `products.base_id` | `bases` | The base a product is customised on. The product's record shows the Customiser's product panel. |
| `options.feature_id` | `features` | The option row that prices a feature. |
| `order_lines.design_id` | `designs` | The customer's design an order line is made from. The line's record shows the order-line panel. |
| `order_line_features.feature_id` | `features` | A feature a line pays for. |

The line's design is filled only from the code the customer's page sends, never from a key the
browser names: a [`lookup`](https://docs.adminium.dev/reference/manifest/#typed-codes) from a text column into the
Customiser's designs. The public entry lists `design_code` among a line's `writable` columns, never
`design_id`.

```json
{ "ref": "design_code", "type": "text", "maxLength": 40, "nullable": true },
{ "ref": "design_id", "type": "int", "nullable": true,
  "rules": { "addOnLink": { "addOn": "customiser", "table": "designs" },
             "lookup": { "from": "design_code", "table": { "addOn": "customiser", "table": "designs" },
                         "column": "code" } } }
```

The order lines' table then asks the Customiser whether each design may be ordered as it is, and
posts it when the line is made:

```json
{ "ref": "order_lines", "columns": [ … ],
  "check": { "by": { "addOn": "customiser" }, "design": "design_id",
             "paid": { "table": "order_line_features", "via": "line_id", "feature": "feature" } },
  "postings": [
    { "id": "design",
      "into": { "addOn": "customiser", "ledger": "designs", "action": "order" },
      "via": "order_id",
      "post": { "on": { "create": true } },
      "map": { "design": "design_id" },
      "only": { "column": "design_id", "set": true } } ] }
```

- **The check** runs inside the save and the quote. It refuses a design that breaks its own rules
  (words too long, a font the base does not offer, a part that is locked), and a line whose paid
  features are not the ones the design uses. See
  [A design an add-on checks](https://docs.adminium.dev/reference/manifest/#a-design-an-add-on-checks) and
  [A refused design](https://docs.adminium.dev/reference/errors/#a-refused-design).
- **The posting** snapshots the design as a new version and locks its draft, in the same save as
  the line. A design ordered again without a change gets no new version. See
  [Rows that post into a ledger](https://docs.adminium.dev/guides/apps/postings/).
