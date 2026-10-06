<!-- produced from apps/docs/src/content/docs/guides/apps/postings.md § What a writer is told; do not edit -->

# Rows that post into an add-on's ledger: What a writer is told

| Code | Reason | Meaning |
|---|---|---|
| `POSTING_REFUSED` | `out-of-stock`, `expired`, `needs-batch` | the add-on's own refusal on a stock ledger |
| | `not-valid`, `inactive`, `void`, `empty`, `used-up`, `over-limit`, `needs-customer`, `refund-over` | the add-on's own refusal on a ledger of value (a card, a voucher) |
| | `mapped-changed`, `receipt-open` | put it back first |
| | `one-at-a-time` | this way of writing cannot post: save the row by itself |
| | `add-on-unavailable` | the add-on cannot be asked now |
| | `planner-failed`, `too-large`, `hooked`, `guarded` | a fault of the add-on or of the setup: an audit row `ledger.refused` says which |
| | `card-pays-card` | a line of the same order forbids it |
| `WRITE_CONFLICT` | | something this save stood on moved while it waited: send it again |
| `CAPACITY_BUSY` | | another save held the same ledger rows for ten seconds: send it again |

A guest hears two of these by name: `PUBLIC_OUT_OF_STOCK` (with the line, and what is left when
the owner shows it) and `PUBLIC_CARD_REFUSED` (always `not-valid`, whatever the real reason: a
stranger learns nothing about a card they do not hold — a code that names no card at all is told
in the same words). Every other reason reaches a guest as the
plain refused write. The full lists are in the [error reference](https://docs.adminium.dev/reference/errors/#a-ledgers-refusal).
