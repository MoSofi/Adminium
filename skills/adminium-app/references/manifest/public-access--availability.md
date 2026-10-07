<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Availability; do not edit -->

# Manifest spec: Public access — Availability

### Availability

An `availability` entry on a table with a [`capacity`](https://docs.adminium.dev/reference/manifest/#capacity) answers by the limit's kind:

| Kind | A page asks | The answer |
|---|---|---|
| `slot` | A day (or a run of days) and a party | Each slot, free or full. |
| `parent` | The pools under a row (`under`: a column of the pool's rows, such as an event's ticket types) | Each pool, on sale or sold out. |
| `night` | Arrival and departure, and the guests | Each pool that has a room on every night. |

| Field | Rule |
|---|---|
| `rule` | Which of the table's limits it answers, 0–2 (absent: the first). |
| `showLeft` | `{ "below": n }` or `{ "belowShare": 1–100 }`: say how many are left, but only when little is (below a number, or a share of the pool). A parent or night limit only. |
| `under` | A parent limit only: the column of the pool's rows a page asks by. |

A night rule counting one unit per row (`size: 1`) has no pool to answer. A slot rule whose
`amount` is a column needs that column's `validation.max`: a party asked about is capped at it, or
a page asking ever larger parties would learn how full each time is. Parent and night answers read
the pool's rows, so the key also needs a plain read entry on the pool's table. Rows of the
session's own open hold are left out of a count when asked (`exclude`); ids outside the session
are ignored. A code that unlocks a hidden pool travels in the `x-adminium-code` header. For the
query parameters, see the [REST API](https://docs.adminium.dev/reference/rest-api/).

An entry may instead be answered by an add-on: `"words": "<add-on key>:<words id>"` names one of
its [stock words](https://docs.adminium.dev/reference/manifest/#stock-words), and each row asked about is `in`, `low` or `out`. The add-on is one
the manifest names.
