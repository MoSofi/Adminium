<!-- produced from apps/docs/src/content/docs/guides/apps/postings.md § Trying a save first; do not edit -->

# Rows that post into an add-on's ledger: Trying a save first

A [dry run](https://docs.adminium.dev/reference/manifest/#dry-runs-price-checks-and-retries) asks the add-on too, and writes
nothing. A ledger's refusal is its **answer**, not a failure:

```json
{ "data": { "…": "…" },
  "postings": [{ "ledger": "stock", "state": "refused", "reason": "out-of-stock", "line": 2, "left": "3", "item": "Tote" }] }
```

`state` is `ok`, `refused` or `unavailable`. `left` and `item` are told only to a caller who may
read the ledger's own tables; a guest is told what the add-on's owner chose to show. A dry run
reads without locking, so it can say `ok` a moment before somebody else takes the last one: the
save is what decides, and is told the same reason.
