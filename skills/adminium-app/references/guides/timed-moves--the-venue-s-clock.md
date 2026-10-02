<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md § The venue's clock; do not edit -->

# Timed moves on the venue's clock: The venue's clock

Every moment is read on the venue's clock: the time zone of the app's connection, or UTC when none
is set. The server's own zone never matters. A 21:00 closing is 21:00 where the venue is, in
winter and in summer.

A wall time the clocks skip in spring is read as the hour after: 02:30 on the morning the clocks go
forward is 03:30. A wall time they pass twice in autumn is read as the first.
