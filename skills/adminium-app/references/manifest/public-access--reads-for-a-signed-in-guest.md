<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Reads for a signed-in guest; do not edit -->

# Manifest spec: Public access — Reads for a signed-in guest

### Reads for a signed-in guest

An entry with a `level` and no `claim`, `claimedBy` or `visibleWith` reads its table's rows (within
its filters) for a signed-in session of its key alone, never for a stranger: a hotel's rate cards
shown to a guest who has booked. It only reads, lists what it shows in `select`, and says the
`level` its key's sessions are.
