---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
'@adminium/tokens': patch
'@adminium/docs': patch
---

**A public API documentation page at `/api-docs`, switched on from Workspace settings.**

Workspace settings gains a **Public API** card for holders of `api-keys.manage`, with two
switches that apply the moment you click them:

- **Public API** turns the public API on or off. It moved here from the old public API page.
- **API documentation page** publishes `/api-docs`. It is off by default and does not travel in
  a config bundle.

If `ADMINIUM_PUBLIC_API_ORIGINS` is not set, the card says so and how to fix it.
`GET/PUT /api/v1/public-api` report and accept `docsEnabled`, and a PUT may change either
switch on its own.

`/api-docs` works without signing in. It lists only endpoints that a live key can call, with
the methods keys were granted, and for each one its path, auth level, limits and column
names and types. It never shows a table name, a filter, a row count or a key. While the page is
off, the page and `GET /api/v1/api-docs` answer the ordinary not-found response. On a domain
mapped to a hosted app they are not served at all.

The page has a playground. Paste a browser key and it sends a real request with that key only.
The key is never stored, never put in a URL or code sample, and your session cookie is not
sent. The page shows the real status, the time taken and the response body. Code samples in
cURL, JavaScript (`@adminiumjs/public-client`) and Python use the real paths and headers.
