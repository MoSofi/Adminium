<!-- produced from apps/docs/src/content/docs/guides/apps/undo-a-status-move.md § What a writer is told; do not edit -->

# Undo a status move: What a writer is told

| Code | Status | When |
|---|---|---|
| `STATE_MOVE_REFUSED` | 409 | The row is not in the state the write named (`details.named`), an undo named no state (`details.undo: true`), the undo's time has passed (`details.requires: "time"`), or the write sent a value for a column the undo empties (`details.clears`). `details.from` and `details.to` name the move. |
| `VALIDATION_FAILED` | 422 | `from` sent for a table that keeps no states. |
| `UNDO_EXPIRED` | 410 | The Undo button's 60 seconds are over. |
| `CONFLICT` | 409 | Undo on a table that keeps states and lists no move back (`details.reason: "UNDO_STATES"`), or a row changed since the save (`details.code: "UNDO_CONFLICT"`). |
| `WRITE_CONFLICT` | 409 | The row was moved back and on again by someone else while the undo was made (`details.retry: true`). Make it again. |

The full list is in [Errors](https://docs.adminium.dev/reference/errors/).
