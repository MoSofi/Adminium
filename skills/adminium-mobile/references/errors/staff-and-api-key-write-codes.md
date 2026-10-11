<!-- produced from apps/docs/src/content/docs/reference/errors.md § Staff and API-key write codes; do not edit -->

# Error codes: Staff and API-key write codes

A write through the data routes (`/api/v1/data/:connection/:table…`), a desk screen or a
role-bound key answers with the staff envelope:

| Code | Status | When | details |
|---|---|---|---|
| `VALIDATION_FAILED` | 422 | A value refused, or a request the route does not take. | See [below](https://docs.adminium.dev/reference/errors/#validation_failed) |
| `UNIQUE_VIOLATION` | 409 | A unique rule already holds that value. | `constraint`, `detail`, `columns` |
| `FK_VIOLATION` | 409 | A link to a row that is not there, or a delete of a row others still link to. | `constraint`, `detail` |
| `CAPACITY_FULL` | 409 | A limit has no room for the row. | See [below](https://docs.adminium.dev/reference/errors/#capacity_full) |
| `CAPACITY_BUSY` | 409 | Another write held the limit's lock longer than a write waits (10 seconds). Try again. | none |
| `CAPACITY_TOO_LATE` | 409 | A guest's cancellation inside a slot limit's `cancelHours`. | `column` |
| `NUMBER_BUSY` | 409 | Another write is taking the next number of the same series. Try again. | none |
| `BOOKING_TAKEN` | 409 | Another counted visit of that person overlaps it. | `column` |
| `BOOKING_CLOSED` | 409 | A closure covers the day. | `column` |
| `BOOKING_BUSY` | 409 | Another booking of that day is being written. Try again. | none |
| `BOOKING_TOO_LATE` | 409 | A guest's move or cancellation inside a booking rule's window. | `column` |
| `BALANCE_EXCEEDED` | 409 | A payment or a change that takes a balance kept at zero or above below zero. | `column`, `balance` (what it was) |
| `CONFLICT` | 409 | A write of many rows that must be made one at a time: `details.reason` is `CAPACITY_ONE_AT_A_TIME` (rows that take from a limit) or `BALANCE_ONE_AT_A_TIME` (rows that move a balance). | `reason` |
| `WRITE_CONFLICT` | 409 | Two writers at once, a row that moved between being found and being held, or the database giving this write up (a deadlock, a serialization failure, a busy SQLite file). The same write a moment later goes through. | `retry: true`, and `column` or `table` when known |
| `STATE_MOVE_REFUSED` | 409 | A move the table's [states](https://docs.adminium.dev/reference/manifest/#states) do not allow now. | See [below](https://docs.adminium.dev/reference/errors/#states) |
| `STATE_UNCHANGED` | 409 | The write names the state a strict row already holds. | `column`, `state`, `at`, `by`, the `show` columns |
| `STATE_TOO_LATE` | 409 | A [late move](https://docs.adminium.dev/reference/manifest/#late-moves) in mode `refuse`, inside its window. | `column`, `at` |
| `WRITE_WINDOW_CLOSED` | 409 | A change outside the [window](https://docs.adminium.dev/reference/manifest/#windows-on-a-moment) its entry opens. | `column`, `bound`, `at`, `rowAt`, `reason` |
| `RECORD_LOCKED` | 409 | A column that can no longer change, or a child row whose parent is not in a state that lets it change. | See [below](https://docs.adminium.dev/reference/errors/#states) |
| `DELETE_REFUSED` | 409 | A row that is numbered, in a state that is never deleted, or locked. Void it instead. | `state`, `numbered` |
| `FOLLOW_TOO_MANY` | 409 | More than 500 rows [follow](https://docs.adminium.dev/reference/manifest/#copies-that-follow) the changed row. Change them in smaller steps. | `table`, `count` |
| `PRICE_CHANGED` | 409 | The save came to another figure than the price the desk showed (`expect`). Nothing was kept. | `column`, `total` |
| `ROW_CHANGED` | 409 | A column the form loaded (`seen`) holds another value now. Nothing was kept; read the row again. | `column`, `expected`, `retry` |
| `DOCUMENT_NOT_FOR_ROW` | 409 | The app's document kind is only for some rows (its `where`), and this row is not one of them: money given back has no receipt. Nothing was drawn. | `kind` |
| `NIGHTLY_RATE_UNREADABLE` | 409 | A [price by the night](https://docs.adminium.dev/reference/manifest/#prices-by-the-night) reads a rate rule that cannot be read. Correct the rule. | `table`, `key`, `column` |
| `COLUMN_FORBIDDEN` | 403 | A column the caller's role does not read, reads masked, or may not change. | `table`, `column`, `reason` |
| `TABLE_FORBIDDEN` | 403 | The caller's role lacks the table permission the write needs, on the table or a child table. | `permission` |

A bulk edit or delete adds the row's `id` to a state refusal's details. The rest of this section
takes the codes with the most to say.
