<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md § The data kit — Reading an app's prices; do not edit -->

# Add-ons that keep tables of their own: The data kit — Reading an app's prices

### Reading an app's prices

An add-on's features may cost the shopper something, and the price is the app's: each app sells
them at its own price. The app keeps it on a row of its own that links to the add-on's row with
[`addOnLink`](https://docs.adminium.dev/reference/manifest/#binding-an-add-on-to-the-apps-rows), and a page of the add-on reads it
there. Nothing new is granted for it.

```json
{ "ref": "options", "columns": [
  { "ref": "feature_id", "type": "int", "nullable": true,
    "rules": { "addOnLink": { "addOn": "customiser", "table": "features" } } },
  { "ref": "price", "type": "decimal", "scale": 2 },
  { "ref": "cost", "type": "decimal", "scale": 2 } ] }
```

A table with a link into one of the add-on's tables is one of those that hand it rows, so the
kit's read lists it as `maker:options`, and `useRecords('maker:options', …)` reads it. The page
reads it with the reader's own grant on the app's table, which the app's role gives. Give it only
the link and the price:

```json
{ "key": "designer", "name": "Designer",
  "permissions": ["table:@options:read"],
  "limits": { "options": { "readable": ["feature_id", "price"] } },
  "tables": [{ "addOn": "customiser", "table": "features", "actions": ["read"] }] }
```

```tsx
const { rows } = useRecords('maker:options', {
  filter: [{ column: 'feature_id', op: 'in', value: featureIds }],
  columns: ['feature_id', 'price'],
});
```

The price comes back as text, so nothing is rounded. A page only reads such a table: a write there
is refused. A reader whose role does not read it is refused (`403`), so show the feature without
its price then.
