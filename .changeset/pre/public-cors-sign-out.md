---
'@adminium/server': patch
---

**A cross-origin `signOut()` now reaches the server, and a page can read
`Retry-After`.**

`@adminiumjs/public-client`'s `signOut()` sends `DELETE /api/v1/public/session`.
From another origin, a browser checks with the server before sending it. That
check always failed: `/public/session` answered no such check, and the answer
every other public path gave allowed `GET, POST, PATCH` but not `DELETE`. The
client forgot the session anyway, but the server kept it until it expired.
`/public/session` now answers the check, and every public path allows `DELETE`.

No public response let the page read its `Retry-After` header. A browser hides
that header from another origin unless the server names it, so the client's
`retryAfterSeconds` was always `null` there. Public responses to an allowed
origin now name it in `Access-Control-Expose-Headers`.

Some errors reached another origin with no CORS headers at all, so the page
saw a network error instead of the error code. These were requests the server
rejected as malformed (such as `limit=500`), and requests refused by the
instance-wide limit of 600 a minute per address. They now carry the same
headers as every other public response.

That instance-wide limit also answered with the wrong error:
503 `PUBLIC_UPSTREAM_UNAVAILABLE`, which reads as "the server is down" rather
than "slow down". It now answers 429 `PUBLIC_RATE_LIMITED` with
`Retry-After`, the same response the public API's other limits give.
These refusals no longer write a warning to the server log each time, so a
flood of requests no longer floods the log. The normal request log still
records each one.

The OpenAPI spec now lists that 429 for `GET /api/v1/public/config` and
`DELETE /api/v1/public/session`. Every other public route already did, but
these two could always answer it too.
