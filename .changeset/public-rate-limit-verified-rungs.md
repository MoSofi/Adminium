---
'@adminium/server': patch
---

**A forged session header no longer resets the public claim limit.**

The public API's rate limiter counted each request once, before the key or
the session was checked. It named the bucket after the first 16 characters
of the token, or after the raw `x-adminium-public-session` header when one
was sent. The server checked only the header's `adm_pubs_` prefix. So a
random session header on every attempt got a fresh 5-a-minute
`POST /public/claim` bucket on every attempt. Claims, the guard on guessing
order references, then ran at the 600-a-minute backstop instead. Random
tokens did the same to the pre-check bucket, and each one cost a database
lookup and a new entry in the limiter's memory.

Each request is now counted twice:

- **Before the key is checked**, on the caller's address only: 300 requests
  a minute, any route. An IPv6 caller is counted by its /64.
- **After**, on the class limits (120 reads, 20 writes, 5 claims a minute).
  A session gets its own allowance only after its row is found, and the
  bucket is keyed by the row. A header that matches nothing counts as an
  anonymous caller. Claims never use the session bucket.

A signed-in customer still has their own read and write allowance, and
anonymous traffic on the same key can't use it up.
