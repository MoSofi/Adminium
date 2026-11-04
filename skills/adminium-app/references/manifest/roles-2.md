<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Roles; do not edit -->

# Manifest spec: Roles

Every staff read of the table holds to it: lists and records, links and lookups, search, exports,
imports, dashboard cards and their live updates, documents, the audit log, files kept in a hidden
column, and the page assistant. Selecting, filtering or sorting by a hidden column is refused `403`
`COLUMN_FORBIDDEN` with `details.reason: "read-limit"`; a lookup into one reads as masked. A
refusal never repeats a hidden value, and the desk's limit counts and nightly lines are refused
when the rule reads a hidden column. A hidden column is not written through the role either,
creates included, unless `writable` names it. Roles add up: two limited roles read the union of
their columns, one unlimited read of the table reads it all, and a Super Admin is never limited.

A role that signs in a staff-bound browser key (a check-in tablet; see [publicKeys](https://docs.adminium.dev/reference/manifest/#publickeys))
must be `screensOnly`, with no `cloneFrom` and no grant but `app:@:staff`.
