<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § What a writer is told; do not edit -->

# Booking rules and limits: What a writer is told

Through the public API:

| Code | Status | When |
|---|---|---|
| `PUBLIC_SLOT_FULL` | 409 | The time was taken while the guest was choosing. |
| `PUBLIC_SLOT_BUSY` | 409 | Someone else is booking that day this instant. Try again. |
| `PUBLIC_TOO_LATE` | 409 | A late move, or a late cancellation in mode `refuse`. |
| `PUBLIC_WRITE_REFUSED` | 400 | The time is not bookable. `params` says the column and why: `closed`, `out-of-hours`, `out-of-range` or `not-offered`. |

In the dashboard and the REST API:

| Code | Status | When |
|---|---|---|
| `BOOKING_TAKEN` | 409 | Another counted visit of that person overlaps it. |
| `BOOKING_CLOSED` | 409 | A closure covers the day. |
| `BOOKING_BUSY` | 409 | Another booking of that day is being written. Try again. |
| `VALIDATION_FAILED` | 422 | `details.reason` is `BOOKING_OUT_OF_HOURS`, `BOOKING_OUT_OF_RANGE` (past, beyond the window, inside the notice) or `BOOKING_NOT_OFFERED`, and the field is named. |

A change to several visits at once that moves them, or gives them a counted status, is refused
`409` with the reason `CAPACITY_ONE_AT_A_TIME`: each has to be judged on its own. Marking several
visits cancelled or no-show together goes through.
