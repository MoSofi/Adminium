<!-- produced from apps/docs/src/content/docs/guides/apps/undo-a-status-move.md § An email that waits; do not edit -->

# Undo a status move: An email that waits

The customer's "Your order is ready" email must not go the instant the kitchen taps Ready: the tap
may be taken back. An outbox producer can wait a few seconds with `holdSeconds`, and `dropWhen`
drops the message if the order is no longer ready by then:

```json
{
  "kind": "order-ready",
  "link": "order_id",
  "onChange": { "table": "orders", "column": "status", "to": "ready" },
  "holdSeconds": 20,
  "dropWhen": [{ "column": "status", "in": ["placed", "confirmed", "preparing"], "reason": "no-longer-needed" }]
}
```

- The message is queued with its due time 20 seconds on, in the outbox's due column. `holdSeconds`
  is 1 to 3600, and needs that column. It takes no `hold`, `due`, `batchMinutes` or `before` as
  well.
- The sender takes it on its next pass once it is due, so it goes up to about a minute after the
  hold ends. Just before it goes, the drop conditions are asked again.
- An order taken back in time has its message `skipped`, with the reason `no-longer-needed`.
- **A dropped message does not stop the next one.** An email of a kind is normally sent once per
  row. A message dropped while it waited does not count, so Ready, Undo, Ready sends exactly one
  email, for the second Ready.

A `dropWhen` needs a message that waits: without `holdSeconds` (or a hold, a due date or a batch)
the check says `only a message that waits (held, or due later) can be dropped`. See
[An app's emails](https://docs.adminium.dev/guides/apps/emails/).
