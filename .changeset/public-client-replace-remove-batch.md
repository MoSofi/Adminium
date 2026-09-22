---
'@adminium/public-client': patch
---

**The public client can replace, delete and batch-write rows, and `list()` reads every response shape.**

- `replace(ref, id, values)` sends a PUT. Every column the key may write must be included.
- `remove(ref, id)` deletes one row.
- `batch(ref, rows)` writes 1 to 500 rows in one transaction and returns `{ count }`.

`list()` returns `{ data, cursor }` whether the endpoint answers wrapped, as a bare array (the
next cursor comes from `X-Next-Cursor`) or as a single row, and it makes no extra request to
find out which. `PublicAction` gains `replace`, `delete` and `batch`, and a ref's config may
carry `response.shape`. These need a server from 0.3.0.
