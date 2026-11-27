---
'@adminium/manifest': patch
'@adminium/server': patch
---

An app's check now refuses a `publicAccess` entry that adds or changes rows and leaves a browser nothing to set, where the entry is written. A Designer wrote `{ "table": "order_requests", "methods": ["POST"], "select": ["id"] }` for an order form that sends six columns; the check passed, the app was applied, and the mistake showed only when a person opened the app's page to allow its public access: the endpoint could not be made ("declares "create" but lists no writable columns") and Allow stayed off. The manifest's validator now says "this entry adds rows, so list the columns a browser may set in writable" at `publicAccess.<n>.writable`, so the Designer's `check_app`, `adminium app check`, a build and an install all read it before anything is applied.

The condition is the endpoint's own: a `writable` list left empty, an entry seen with a parent (`visibleWith`) that names none, or no list where what `select` shows is only the key, a column a filter holds, the `claimedBy` column or what Adminium fills. `PATCH` (and `PUT` and `BATCH` in a file made on an Adminium) is held to the same. An entry the endpoint is made for is not refused: `{ "methods": ["POST"], "select": ["id", "message"] }` still lets a browser set `message`. A manifest that validated before and is refused now is one whose endpoint could never have been made.
