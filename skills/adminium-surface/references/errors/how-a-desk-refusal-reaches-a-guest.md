<!-- produced from apps/docs/src/content/docs/reference/errors.md § How a desk refusal reaches a guest; do not edit -->

# Error codes: How a desk refusal reaches a guest

A guest's write runs the same checks as a staff write. The public API then answers with its own
code:

| Staff refusal | Public answer |
|---|---|
| `CAPACITY_FULL`, kind `slot` | `409` `PUBLIC_SLOT_FULL`, `{ column }` |
| `CAPACITY_FULL`, kind `parent` | `409` `PUBLIC_SOLD_OUT`, `{ column }` |
| `CAPACITY_FULL`, kind `night` | `409` `PUBLIC_NO_ROOM`, `{ column, night }` |
| `CAPACITY_FULL` for a code's uses | `400` `PUBLIC_WRITE_REFUSED`, `{ column, reason: "used-up" }` |
| `BOOKING_TAKEN` | `409` `PUBLIC_SLOT_FULL` |
| `CAPACITY_BUSY`, `BOOKING_BUSY`, `NUMBER_BUSY`, `WRITE_CONFLICT` | `409` `PUBLIC_SLOT_BUSY` |
| `CAPACITY_TOO_LATE`, `BOOKING_TOO_LATE` | `409` `PUBLIC_TOO_LATE` |
| `STATE_TOO_LATE` | `409` `PUBLIC_TOO_LATE`, `{ at }` |
| `WRITE_WINDOW_CLOSED`, or `STATE_MOVE_REFUSED` waiting for a time: before it opens | `409` `PUBLIC_TOO_EARLY`, `{ at, from }` |
| The same, after it closed | `409` `PUBLIC_TOO_LATE`, `{ at }` |
| The same, shut by a linked row or a moment with no value | `400` `PUBLIC_WRITE_REFUSED` |
| `STATE_UNCHANGED` | `400` `PUBLIC_WRITE_REFUSED`, `{ column, reason: "unchanged" }` |
| `BOOKING_CLOSED` | `400` `PUBLIC_WRITE_REFUSED`, `{ column, reason: "closed" }` |
| `VALIDATION_FAILED` with `details.reason` `BOOKING_OUT_OF_HOURS`, `BOOKING_OUT_OF_RANGE`, `BOOKING_NOT_OFFERED`, or a `CAPACITY_*` reason | `400` `PUBLIC_WRITE_REFUSED`, `{ column, reason }` |
| `VALIDATION_FAILED` on a column the entry writes, for a reason a guest is told | `400` `PUBLIC_WRITE_REFUSED`, `{ column, reason }` |
| A project hook's refusal | `400` `PUBLIC_WRITE_REJECTED` |
| Anything else: `STATE_MOVE_REFUSED`, `RECORD_LOCKED`, `DELETE_REFUSED`, `BALANCE_EXCEEDED`, `FOLLOW_TOO_MANY`, `NIGHTLY_RATE_UNREADABLE`, `UNIQUE_VIOLATION`, `FK_VIOLATION`, `CONFLICT` | `400` `PUBLIC_WRITE_REFUSED` |

On a create with child rows, each public answer about a child row adds `child`, `index` and
`path`.
