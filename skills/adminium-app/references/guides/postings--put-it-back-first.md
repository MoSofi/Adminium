<!-- produced from apps/docs/src/content/docs/guides/apps/postings.md § Put it back first; do not edit -->

# Rows that post into an add-on's ledger: Put it back first

While a round is open for a row — something is held or taken and not given back — the row is
kept as the add-on read it:

- A column the rule maps, multiplies by or filters on cannot be changed:
  `409 POSTING_REFUSED {reason: "mapped-changed", column}`.
- The row cannot be deleted: `409 POSTING_REFUSED {reason: "receipt-open"}`.

The way through is the rule's own `reverse`: cancel the order (or void the line), change it, and
send it again. That is "put it back first". A line with no open round changes freely.

A many-row change is held to the same thing and to one more: it cannot move a row into a state
its rules take things for good in while a payment of that row is still kept until a time. Only a
save of that one row tells the payment it now stands.

The same holds for the rule itself. An owner's rule that rows still hold something under keeps
where it goes, when it fires and what it hands over, and cannot be removed, until those rows are
put back: `409 POSTING_REFUSED {reason: "receipt-open", rows}`.
