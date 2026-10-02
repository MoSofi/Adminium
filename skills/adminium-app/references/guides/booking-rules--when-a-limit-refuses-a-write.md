<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § When a limit refuses a write; do not edit -->

# Booking rules and limits: When a limit refuses a write

In the dashboard and the REST API:

| Code | Status | When |
|---|---|---|
| `CAPACITY_FULL` | 409 | The pool has no room. `details` has `kind`, `column` (the column the pool is counted by), `rule`, `row`, `pool` (`key`, and `at`, the day or night), and `left`, the places that were left before this write. |
| `CAPACITY_BUSY` | 409 | Another write holds the pool's lock. Try again. |
| `VALIDATION_FAILED` | 422 | The place is not one the venue offers. The field is named, and `details.reason` is `CAPACITY_OUT_OF_RANGE`, `CAPACITY_OUT_OF_HOURS`, `CAPACITY_CLOSED`, `CAPACITY_PAUSED`, `CAPACITY_NOT_ON_SALE` or `CAPACITY_TOO_MANY`. |

A caller who may not read a column the rule reads is told the code and the column, without `pool`
and `left`. A slot rule written before limits had kinds answers `CAPACITY_FULL` with the column
only, and its `422` without a reason.

Through the public API:

| Code | Status | When |
|---|---|---|
| `PUBLIC_SLOT_FULL` | 409 | A slot limit is full. `params.column`. |
| `PUBLIC_SOLD_OUT` | 409 | A parent limit is sold out. `params.column`, and in a create with child rows which row. |
| `PUBLIC_NO_ROOM` | 409 | A night limit has no room. `params.night` is a night of the guest's stay that has none. |
| `PUBLIC_SLOT_BUSY` | 409 | Someone else is writing to that pool this instant. Try again. |
| `PUBLIC_TOO_LATE` | 409 | A cancel inside the slot limit's `cancelHours`. |
| `PUBLIC_WRITE_REFUSED` | 400 | The place is not offered. `params.column`, and `params.reason`: `out-of-range`, `out-of-hours`, `closed`, `paused`, `not-on-sale` or `too-many`. |

A guest is never told how full a pool is or whose rows fill it. Every code is listed in the
[error reference](https://docs.adminium.dev/reference/errors/).
