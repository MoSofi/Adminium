<!-- produced from apps/docs/src/content/docs/guides/apps/undo-a-status-move.md § The Undo button; do not edit -->

# Undo a status move: The Undo button

After most saves, the dashboard offers **Undo** for 60 seconds, to the person who made the change.
The save's reply carries an `undoToken`, and `POST /api/v1/data/undo/<token>` spends it.

**For a status move the app lists an undo for,** the button makes that move back. It is the same
write as the PATCH above, naming the state the save left the row in: judged, stamped and told like
any move. A row moved on since is refused, and so is an undo past its time.

**For a status move that also changed another row, there is no Undo.** A guest checked out turns
their room to `cleaning` by an [effect](https://docs.adminium.dev/reference/manifest/#effects). A move back of the stay would
leave the room as it is, so no undo is offered. Moving the stay back is still the app's to offer, as
a move of its own.

**For any other change to a table that keeps states,** or to the rows tied to one (a sent
invoice's lines), there is no Undo either. A mistake there is moved on, voided or sent back, never
unwritten.

**For a change to a table without states,** Undo restores the columns as they were, without judging
any rule. It is history put back:

- **Emails.** A producer that watches for "these columns changed" hears the undo, so a stay whose
  dates are put back is mailed the dates as they are again. A producer that watches for a column
  changing *to* a value does not hear it, and nothing is queued for a new row.
- **Automations** do not hear an undo.
- **Codes.** A code nothing renews is put back as it was. A code that a change of hands renews is
  never put back. Undoing a hand-over puts the old holder back and makes the code again, so neither
  the code the row had before nor the one handed on works afterwards. Any other undo keeps the
  row's current code.
