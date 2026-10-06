<!-- produced from apps/docs/src/content/docs/guides/apps/postings.md § When the add-on cannot be asked; do not edit -->

# Rows that post into an add-on's ledger: When the add-on cannot be asked

An add-on's code may be missing for a while: it is being updated, switched off for the app, or its
files are not there.

| The rule's add-on is | A save that would fire the rule |
|---|---|
| not installed here, or not connected to the app | goes through. The rule reads as not there. |
| installed, and cannot answer now | a `reverse` always goes through; a `reserve` or `post` is refused `409 POSTING_REFUSED {reason: "add-on-unavailable"}` — unless the action says which rows may be taken unasked (stock a shop sells whether or not the count is right), and every row it would take from says so |
| switched off by the owner (the rule's own switch) | starts nothing; a round already open is still given back |

A save let through unasked leaves a receipt marked as waiting. Nothing is taken off the ledger
yet. The add-on's rules page says how many wait and offers **Record them now**, which works them
out oldest first once the add-on can answer.

A rule that names something the add-on does not have — an action or an input from another
version, a column that is gone — cannot answer either. It is listed as unavailable on the rules
page and never half-run.
