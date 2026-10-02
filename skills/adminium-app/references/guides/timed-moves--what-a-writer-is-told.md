<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md § What a writer is told; do not edit -->

# Timed moves on the venue's clock: What a writer is told

In the dashboard and the REST API:

| Code | Status | When |
|---|---|---|
| `STATE_MOVE_REFUSED` | 409 | A move made outside the time it waits for. `details.requires` is `time`, `details.bound` is `after` or `before`, and `details.at` is the moment. With `details.reason` `no-moment`, the moment has no value. |
| `STATE_TOO_LATE` | 409 | A late move in mode `refuse` with `refuse: "everyone"`. `details.at` is the moment. |
| `WRITE_CONFLICT` | 409 | A late move's window opened while the write was made. Try again. |

Through the public API:

| Code | Status | When |
|---|---|---|
| `PUBLIC_TOO_EARLY` | 409 | The move opens later. `params.from` is when it opens, `params.at` the row's time it is counted from. |
| `PUBLIC_TOO_LATE` | 409 | The move closed, or a late move in mode `refuse`. `params.at` is when. |

A window closed by a moment with no value, or by a linked row, is refused without naming a time. The
full list is in [Errors](https://docs.adminium.dev/reference/errors/).
