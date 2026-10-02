<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md; do not edit -->

# Timed moves on the venue's clock

Some rows should move on without anyone touching them. An online order still `placed` when the
kitchen closes will never be cooked. A ticket offered to a friend who never accepts should go back
to its buyer. A hotel guest who has not arrived by the next morning is a no-show. An app says so
with **timed moves**: listed moves Adminium makes by itself once a moment of the row has passed.

A timed move is one of the table's [states](https://docs.adminium.dev/reference/manifest/#states). It moves the row by a move
the table already lists, as an ordinary write: its stamps are written, its effects made, its emails
queued. The fields are in the [manifest reference](https://docs.adminium.dev/reference/manifest/#timed-moves).
