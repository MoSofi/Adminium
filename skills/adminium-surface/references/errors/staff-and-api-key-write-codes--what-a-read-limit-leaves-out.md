<!-- produced from apps/docs/src/content/docs/reference/errors.md § Staff and API-key write codes — What a read limit leaves out; do not edit -->

# Error codes: Staff and API-key write codes — What a read limit leaves out

### What a read limit leaves out

A role that reads a table [only in part](https://docs.adminium.dev/reference/manifest/#roles) gets the same codes, with
every value read from a column it may not read left out of `details`: a strict row's `at`, `by`
and `show` columns, a full pool's `pool`, `left` and `at`, the moment a window or a move waits
for, a parent's `state`, a `balance`. The code, the column's name and where it happened stay, so
a form still marks the right field. Naming such a column in a filter, a sort or a price check is
`403` `COLUMN_FORBIDDEN` with `reason: "read-limit"`; a masked column gives no reason; a column a
role may not change gives `reason: "update-limit"` and `writable`.
