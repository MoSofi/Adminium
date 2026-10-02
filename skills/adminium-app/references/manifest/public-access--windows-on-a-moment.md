<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Windows on a moment; do not edit -->

# Manifest spec: Public access — Windows on a moment

### Windows on a moment

A `writableWhen` entry may open a change only inside a window read from [moments](https://docs.adminium.dev/reference/manifest/#moments): a
refund until seven days before the show, a guest's own change of their stay until the cancel-by
time.

```json
"writableWhen": {
  "status": ["booked"],
  "cancel_by": { "before": {} },
  "event_id": { "before": { "column": "starts_at", "minus": { "days": 7 } },
                "where": [{ "column": "refunds_on", "eq": true }] }
}
```

The key says what the window is read from:

- **A date or time column of the row** (`cancel_by`): the window's moments are that column's,
  so each end names no other `column`; it may add a `time`, a shift and `or` fallbacks.
- **A foreign key of the row** (`event_id`): each end names a `column` of the linked row, and
  `where` (1–8 conditions) must hold on that row too (refunds switched on for the event).

`after` and `before` are the window's ends, either or both. The window is judged on the row as
it is stored before the write, so a change that moves the time cannot reopen its own window, and a
guest may never write a column that opens their own window, a time kept on the row included (an
`arrival_time` a moment reads). A change asked for too early is refused `409` `PUBLIC_TOO_EARLY`
with `params.at` (the row's time) and `from` (when the window opens); one too late, `409`
`PUBLIC_TOO_LATE` with `at`. As with `within`, the refusal is said only for a row the caller's own
read reaches.

A create entry that is [visible with](https://docs.adminium.dev/reference/manifest/#rows-visible-with-their-parent) its parent (`POST`, no
`PATCH`) may carry a window keyed by its `visibleWith` link, with the parent's moments at each end:
an extra may be added to a stay only until its cancel-by time. It is judged in the create's
transaction, on the parent.
