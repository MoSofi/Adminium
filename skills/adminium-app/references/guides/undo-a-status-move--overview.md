<!-- produced from apps/docs/src/content/docs/guides/apps/undo-a-status-move.md; do not edit -->

# Undo a status move

The kitchen taps **Ready** on order #2113, then sees it was the wrong ticket. The dish is still on
the pass. The order should go back to `preparing`, as if the tap never happened: the time it was
marked ready is empty again, the customer is not told their food is waiting, and whoever cooks it
next marks it ready properly.

A table that keeps [states](https://docs.adminium.dev/reference/manifest/#states) cannot just be put back as it was. A sent
invoice put back to draft after its email went would be a lie. So an app says which moves may be
taken back, and Adminium makes each one as a move of its own, judged like any other
([reference](https://docs.adminium.dev/reference/manifest/#undo-of-a-move)).
