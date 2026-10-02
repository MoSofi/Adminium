<!-- produced from apps/docs/src/content/docs/guides/apps/undo-a-status-move.md § Doors that never make an undo; do not edit -->

# Undo a status move: Doors that never make an undo

An undo needs a person who names the state they saw. A door that names none can never make one.
The manifest check refuses a timed move by an undo, and refuses the other doors a state that only
undo moves reach:

| Door | Refused with |
|---|---|
| A [timed move](https://docs.adminium.dev/guides/apps/timed-moves/) | `the move from "ready" to "preparing" is an undo, which only a person makes` |
| An [effect](https://docs.adminium.dev/reference/manifest/#effects) of another table's move | `every move of "orders" to "preparing" is an undo, which only a person makes` |
| An email's change once it has gone (`onSent`) | `every move of "projects" to "active" is an undo, which only a person makes` |
| A value a guest may write through the public API | `every move to "offered" is an undo, which only a person makes` |

An automation rule that writes such a state is refused when it is saved, for the same reason.
