<!-- produced from apps/docs/src/content/docs/guides/apps/orders-with-lines.md § The tables; do not edit -->

# An order with its lines: The tables

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

The figures are ordinary [column rules](https://docs.adminium.dev/reference/manifest/#column-rules):

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

The order also has a column for the page's retry key ([below](https://docs.adminium.dev/guides/apps/orders-with-lines/#retries)):

```json
{ "ref": "client_key", "type": "text", "maxLength": 64, "nullable": true, "unique": true }
```
