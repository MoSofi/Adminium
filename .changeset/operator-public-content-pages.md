---
'@adminium/server': patch
---

The operator endpoint now lists live landing pages. `GET /api/v1/operator/public-content` has a `pages` list (each page's published copy, pictures and links), and the `public-page.changed` event can carry `{ "page": … }`, or `{ "page": { "slug", "removed": true } }` when a page is taken down. A service that reads this feed should expect the new item.
