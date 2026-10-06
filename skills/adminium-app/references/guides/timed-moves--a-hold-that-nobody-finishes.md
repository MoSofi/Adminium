<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md § A hold that nobody finishes; do not edit -->

# Timed moves on the venue's clock: A hold that nobody finishes

A [posting](https://docs.adminium.dev/guides/apps/postings/) into an action that holds keeps its hold until the moment
`heldUntil` names. The job that makes the timed moves also looks, each minute, for holds whose
moment has passed and gives each back as the posting's `reverse` would — whatever state the row is
in, and with no move of the row itself. A hold that a move of the row already took or gave back is
simply let go of.

It is the same for a payment an add-on decided as the row was made (a gift card charged to a till
ticket nobody finishes): at its moment the amount is given back to the card and taken off the
row. Once the row reaches a state its posting takes for good, the payment stands and is not looked
at again.

A give-back that is refused (the ledger's own cap would be broken) is left alone for an hour and
tried again, as a refused timed move is.
