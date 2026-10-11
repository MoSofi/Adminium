<!-- produced from apps/docs/src/content/docs/reference/errors.md § Staff and API-key write codes — States; do not edit -->

# Error codes: Staff and API-key write codes — States

### States

`STATE_MOVE_REFUSED` names the state column and the move, `{ column, from, to }`, and adds why:

| Also in details | Why |
|---|---|
| none | The table allows no move from `from` to `to`. |
| `roles` | Only those roles may make this move. |
| `named` | A stale `from`: the writer said the row was in `named`, and it has moved on to `from` since. Look again. |
| `undo: true` | A move marked `undo` is made only by a change that sends `from`, the state it takes the row back from. See [undo of a move](https://docs.adminium.dev/reference/manifest/#undo-of-a-move). |
| `clears` | A move marked `undo` empties this column (`clears` on the move), and the change sent a value for it. Send it empty, or leave it out. |
| `requires`, `min` | The move needs at least `min` rows of the child table `requires`. |
| `requires` | The move [waits for](https://docs.adminium.dev/reference/manifest/#conditions-a-move-waits-for) something: a column name (`requires: "paid"`), `linked` with `via` (and `column` for a condition on the linked row), `setting`, or `time` with `bound` (`after` or `before`) and `at`. A time with no value gives `reason: "no-moment"`; a link the database no longer has gives `unresolved: true`. |
| `create: true` | A new row: `from` is `null`, and `to` is the state it would start in. A new row that names another state than the first has `from: null` without `create`. See [conditions on a new row](https://docs.adminium.dev/reference/manifest/#conditions-on-a-new-row). |
| `effect: "new"` | A change of a link whose [effect](https://docs.adminium.dev/reference/manifest/#effects) moves the row it now points at, when that row is already in the state (`from` and `to` are that state, `column` is the link). |

Two shapes carry no `from`. A move whose effect would move a row of a table that cannot be moved
that way (it keeps a limit or a parent, its own move waits for another row, or a hook watches it)
gives `{ column, to, effect }`, `effect` naming that table, and `hooked: true` for a hook. A hook
that judged the row as it was, on a row that has moved on since, gives `{ expected, retry: true }`.

`RECORD_LOCKED` details:

| Details | Why |
|---|---|
| `{ column, state }` | The row is in a locked state and this column can no longer change. |
| `{ column, linkedFrom }` | A row of `linkedFrom` links to this one and keeps this column as it is. |
| `{ table, parent, state }` | The parent is in a locked state. |
| `{ table, parent, state, parentIn, on }` | The parent is not in one of `parentIn`. `on` is `create` for a row joining the parent, `change` for one staying with it or leaving. |
| `{ column, unresolved: true }`, with `table` on a new link | A link the table's rules follow is no longer in the database, so the row it points at cannot be kept or moved. |
| `{ column }` | The change moves another row too, and this kind of write cannot make that move. |

`STATE_UNCHANGED` repeats when and by whom the strict row got to its state (`at`, `by`, read from
its stamps) and the columns its `strict.show` names, so a scanner can say "already let in at 19:42
by Door 2".
