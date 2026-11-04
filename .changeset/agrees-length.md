---
'@adminium/manifest': patch
'@adminium/server': patch
---

An agreement may compare how many characters a text holds with a number: `{ "column": "lettering", "length": true, "lte": { "via": "product_id", "column": "lettering_limit" } }` holds an order line's lettering to its product's limit. A line over it is refused as `too-long` on the column, on a save and a quote alike; characters are counted as a person counts them, and a product with no limit sets none. Needs `minAdminiumVersion` 0.3.44.
