<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md § What a timed move never does; do not edit -->

# Timed moves on the venue's clock: What a timed move never does

- **An undo.** A move marked `undo: true` is made only by a person who names the state they saw.
  The manifest check refuses a timed move by one, with the sentence `the move from "ready" to
  "preparing" is an undo, which only a person makes`. See
  [Undo a status move](https://docs.adminium.dev/guides/apps/undo-a-status-move/).
- **A move that could never pass.** A move that waits until after the moment it is made at would be
  refused every time. The check refuses it when both read the same column of the row, with no time
  of day and no fallback: a timed move at `offer_until` by a move that waits until `offer_until`
  plus 30 minutes. Anything that depends on the row or the settings is the app's to get right. A
  row refused that way is [set aside](https://docs.adminium.dev/guides/apps/timed-moves/#rows-the-job-sets-aside).
- **Read another row's time.** A timed move reads its own row's columns only. A time that belongs
  to a parent, such as an event's doors, is copied onto the row first.
- **Decide when a hold ends.** A hold never waits for this job. A held order stops counting
  against a limit at its moment by the clock, whether or not it has been moved yet.
