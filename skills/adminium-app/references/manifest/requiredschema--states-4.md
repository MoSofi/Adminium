<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — States; do not edit -->

# Manifest spec: requiredSchema — States

- The move empties each column it `clears`, whether or not the writer sends it. A writer may leave
  it out or send it as `null`; a value is refused `409` `STATE_MOVE_REFUSED`, with
  `details.clears` naming the column, and nothing is written.
- What an undo empties, its `clearOnBack` stamps and its `clears`, is open to the table's `lock`
  for that move only, and only to be emptied. The same column changed by any other write stays
  locked (`409` `RECORD_LOCKED`). The lock's other columns and the rows of `children` tied to it
  stay as they are.
- `clears` names 1–8 columns of the table, each once, that may be empty. It never names the state
  column, the key, or a column another rule writes (a stamp is emptied by `clearOnBack` instead).
  It is refused on a move not marked `undo`: `only a move marked undo empties columns as it goes`.
  A states rule saved in Studio is held to the same checks.
- A move is taken by its target: the first listed from a state to another is the one made. A
  second move between the same two states is refused when either is marked `undo` or names
  `clears`: `another move from "picked_up" to "ready" comes first, so this one is never made`.
- The dashboard's Undo of the forward move makes this move back when the forward change filled
  a column the undo `clears` from empty. When the change overwrote a value already there, the move
  back would lose it, so no Undo is offered. Nor is one offered to a person who holds none of the
  move back's `roles`.
- A take-back whose row was moved back and on again by someone else while it was made is refused
  `409` `WRITE_CONFLICT` with `details.retry: true`: make it again.

A code nothing renews is put back by an undo as it was. A code a change of hands renewed is never
put back: undoing the hand-over makes a code neither holder had. See
[Undo a status move](https://docs.adminium.dev/guides/apps/undo-a-status-move/).
