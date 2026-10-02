<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Dry runs, price checks and retries; do not edit -->

# Manifest spec: Public access — Dry runs, price checks and retries

### Dry runs, price checks and retries

`dryRun: true` lets a page ask for the same create or change without writing: the reply carries
every figure Adminium would work out (the totals, a stay's nights, the stamps it would decide), and
refuses what the save would refuse. A quote takes no locks, keeps nothing and is never charged
against a stranger's limits. A row [visible with a parent](https://docs.adminium.dev/reference/manifest/#rows-visible-with-their-parent) is
created alone, so a quote there belongs to a change.

`expect` names a money column Adminium works out (a `decimal` or `money` column that a rule decides),
which the entry shows in `select`. A write may send the figure the guest was shown (`"expect":
{ "total": "34.10" }`); when the save comes to another figure, nothing is written and the answer is
`409` `PUBLIC_PRICE_CHANGED`, with `params.total` and, on a create, each line's figures
(`params.lines`).

`clientKey` names a `text` column, `unique` and `writable`, that holds a key the browser mints for
the create and sends as that column's value: 22–64 letters, digits, `-` or `_`. A retry of a create that already landed (a reply lost to a dropped connection) answers
the same row, marked `replayed`, even after the entry's switch was turned off; a new create with no
matching key is refused as before. Adminium keeps only a keyed hash of the key, 43 characters: give
the column room for it. No entry shows, filters or orders by a retry-key column. `clientKey` belongs
to a create, and not to a row visible with a parent.
