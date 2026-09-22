---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/docs': patch
---

**The public API gains one-row reads, PUT, DELETE and BATCH, per-endpoint rate limits, list shapes, request counts and server keys.**

New public routes, each allowed only when the key was granted that method on the endpoint:

- `GET /public/records/:ref/:id` reads one row. It returns the same columns as the list and
  hides the same personal data. A row that doesn't exist and a row outside the key's scope both
  answer the same 404.
- `PUT /public/records/:ref/:id` replaces a row. The body must include every column the key may
  write. The scope is part of the UPDATE statement itself.
- `DELETE /public/records/:ref/:id` deletes a row. The scope is part of the DELETE statement
  itself. A row outside the scope answers 404 and is not deleted. When the database refuses a
  delete because of a foreign key, the caller gets one refusal that names nothing. Each delete
  writes an audit row showing the removed row, with personal data masked.
- `POST /public/records/:ref/batch` takes 1 to 500 rows in one transaction, and either all of
  them are written or none are.
  - A row without its primary key is inserted, and the server chooses the key.
  - A row with its primary key updates that row, and the key must also hold PATCH.
  - If any keyed row is missing or outside the scope, the whole batch is refused, without saying
    which case it was.

An endpoint's own rate limit now replaces its class limit. For browser keys it counts per
visitor, and for server keys it counts across the whole key. A batch uses up one request per row.
A request too large to ever fit is refused with 400 rather than 429. Scopes written before this
change keep the limits they had.

An address whose keys keep failing to match is refused after 30 failures a minute, before the
server looks the key up.

A list can be returned wrapped (as before), as a bare array with the next cursor in
`X-Next-Cursor`, or as exactly one row. `Retry-After` and `X-Next-Cursor` can now be read by
pages on other origins.

"Requests · 24h" is counted per key, endpoint and hour. The counts are written every minute and
when the server shuts down, and kept for `retention.publicRequestStatsDays`. The new admin route
`GET /api/v1/public-api/stats` returns the total.

**Server keys** (`adm_srv_`) work without an `Origin` header. They are refused when a request
comes from a browser, are shown only once, and cannot be revealed. Rotating one gives another
server key. Only a server key can be granted a service-role endpoint. A hosted app is never
given a server key.
