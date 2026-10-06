<!-- produced from apps/docs/src/content/docs/guides/apps/postings.md § A hold has an end; do not edit -->

# Rows that post into an add-on's ledger: A hold has an end

An action that holds needs to be told until when, or a customer who never comes back keeps the
stock for ever. `heldUntil` names a date-and-time column of the row (or of its order). When that
moment passes and nothing has taken or given back the hold, Adminium's
[minute job](https://docs.adminium.dev/guides/apps/timed-moves/#a-hold-that-nobody-finishes) gives it back, as the rule's
`reverse` would.

A table whose state has a [timed move](https://docs.adminium.dev/guides/apps/timed-moves/) into a state the `reverse` point
names needs no `heldUntil` for that: the move itself gives the hold back.
