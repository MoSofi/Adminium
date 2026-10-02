<!-- produced from apps/docs/src/content/docs/guides/apps/undo-a-status-move.md § Upgrading; do not edit -->

# Undo a status move: Upgrading

- A records-page save that changes the state now names the state the form loaded. A row another
  screen moved since is refused `STATE_MOVE_REFUSED`, where before it was moved from wherever it
  was.
- Undo of a change to a table without states now sends the app's "these columns changed" emails.
