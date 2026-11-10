<!-- produced from apps/docs/src/content/docs/guides/apps/public-assets.md § What a page loads; do not edit -->

# Models, fonts and SVG pieces on public pages: What a page loads

`/public/config` says where the key's assets are, and which columns of each entry are assets:

```json
{ "data": { "assets": "/api/v1/public/assets/pbk_01J9Z6Q4M2V8XK3T7B5N0R4WQE", "refs": { "nooks_products": { "assets": ["preview", "print", "font", "pieces"] } } } }
```

An asset's full address names the entry, the row, the column and the file:

```text
GET /api/v1/public/assets/{keyId}/{ref}/{rowId}/{column}/{fileId}
```

The file id is the one the row's column holds (for a list, one of them). The route answers a
browser's preflight, so a viewer's `fetch` and a cross-origin `@font-face` both work.
`@adminiumjs/public-client` turns a column's value into the addresses, in the value's order:

```ts
import { assetUrls } from '@adminiumjs/public-client';

const config = await client.config();
const { data: products } = await client.list('nooks_products');
for (const product of products) {
  const [model] = assetUrls(baseUrl, config, 'nooks_products', product.id, 'preview', product.preview);
  const pieces = assetUrls(baseUrl, config, 'nooks_products', product.id, 'pieces', product.pieces);
  // []: nothing Adminium keeps in that column, or the entry serves none there.
}
```
