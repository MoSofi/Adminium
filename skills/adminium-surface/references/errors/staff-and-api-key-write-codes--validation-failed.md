<!-- produced from apps/docs/src/content/docs/reference/errors.md § Staff and API-key write codes — VALIDATION_FAILED; do not edit -->

# Error codes: Staff and API-key write codes — VALIDATION_FAILED

### VALIDATION_FAILED

`details.fields` names each refused column with its `code`: `required`, `too-long`, `too-short`,
`too-small`, `too-large` (with `n`, the bound), `format`, `invalid`, `invalid-character`,
`out-of-range`, `not-allowed`, `unknown`, `used-up`, `plain-text` (a column held to
[plain text](https://docs.adminium.dev/reference/manifest/#column-rules) was given an address or too many digits) and
`not-found` (a [link into an add-on's table](https://docs.adminium.dev/reference/manifest/#column-rules) names no row there).

- **A time of day a moment reads.** A column a [moment](https://docs.adminium.dev/reference/manifest/#moments) reads its
  time of day from (`time: { column }`) is held to `HH:MM`. Anything else is `format`, since it
  would otherwise read as no moment at all. A column of weekdays a price by the night reads
  (`fri,sat`) is held to its form the same way.
- **A price check and a retry key.** `fields.expect` is `not-allowed` when the table names no
  figure to check, the column holds no number, or the save cannot carry one (a repeat, a table a
  hook runs for, a change that sends link fields). `fields.clientKey` is `not-allowed` when the
  table keeps no retry key or the save cannot carry one, and `format` when the key is not 22 to 64 letters, digits, `-` or `_`.
- **A state the writer saw.** `fields.from` is `not-allowed` when the table keeps no states.
- **Dates that only move later.** `details.reason` `ONLY_LATER`, with `out-of-range` on the column.
- **A place the venue does not offer.** `details.reason` is `CAPACITY_OUT_OF_RANGE`,
  `CAPACITY_OUT_OF_HOURS`, `CAPACITY_CLOSED`, `CAPACITY_PAUSED`, `CAPACITY_NOT_ON_SALE` or
  `CAPACITY_TOO_MANY`, with the column in `fields` and the refused row in `row`. The original
  single slot rule gives no reason. A booking rule gives `BOOKING_OUT_OF_HOURS`,
  `BOOKING_OUT_OF_RANGE` or `BOOKING_NOT_OFFERED`
  (see [booking rules](https://docs.adminium.dev/guides/apps/booking-rules/#what-a-writer-is-told)).
- **A create with child rows.** A refusal of a child row adds `relation`, `row`, and `under` for
  a row two levels down.
