<!-- produced from apps/docs/src/content/docs/guides/apps/undo-a-status-move.md § After a posting; do not edit -->

# Undo a status move: After a posting

A save that handed something to an [add-on's ledger](https://docs.adminium.dev/guides/apps/postings/) answers no undo token,
whatever the move says, and no Undo is offered for it: taking it back is more than putting a
column back. The posting's own `reverse` point is the way back — cancel the order, void the line.
An Undo of an earlier change that would cross a posting's point, or change a column an open round
read, is refused `POSTING_REFUSED {reason: "one-at-a-time"}`.
