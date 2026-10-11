<!-- produced from apps/docs/src/content/docs/reference/errors.md § Staff and API-key write codes — CAPACITY_FULL; do not edit -->

# Error codes: Staff and API-key write codes — CAPACITY_FULL

### CAPACITY_FULL

```json
{ "column": "room_type_id", "rule": 0, "kind": "night", "row": 0, "pool": { "key": "2", "at": "2026-12-24" }, "left": 0 }
```

| Key | What it says |
|---|---|
| `column` | The column the row takes by: the slot's time, the line's link, the stay's room type. |
| `rule` | Which of the table's [capacity](https://docs.adminium.dev/reference/manifest/#capacity) rules, from 0. |
| `kind` | `slot`, `parent` or `night`. |
| `row` | The refused row's place among the rows the write handed the guard. |
| `pool` | `key`: the slot's instant, the parent row's key, or the night pool's key. `at`: the venue day or the night counted. |
| `left` | What the pool had left besides this write's rows, when it has a size. |
| `fields` | For a limit on a code's uses: `{ "<typed column>": { "code": "used-up" } }`. |

The original single slot rule answers `{ column }` alone.
