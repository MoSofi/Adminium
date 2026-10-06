<!-- produced from apps/docs/src/content/docs/guides/apps/postings.md § What a rule cannot stand on; do not edit -->

# Rows that post into an add-on's ledger: What a rule cannot stand on

Two things change a row with no save of it, so nothing would tell the ledger. A rule that depends
on either is listed as unavailable on the rules page, and an owner's cannot be saved:

- a column that is a [copy that follows](https://docs.adminium.dev/reference/manifest/#copies-that-follow) the row it is copied from —
  as an input, a multiplier, `heldUntil`, `unlessSet`, `only` or `via`. Map the column it is copied
  from, or a copy that does not follow;
- a point on the state a place kept for a waitlist is moved to when it is claimed (`releaseTo`).
