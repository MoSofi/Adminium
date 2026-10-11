<!-- produced from apps/docs/src/content/docs/reference/errors.md § Staff and API-key write codes — A ledger's refusal; do not edit -->

# Error codes: Staff and API-key write codes — A ledger's refusal

### A ledger's refusal

`409 POSTING_REFUSED`: a save reached a [posting](https://docs.adminium.dev/guides/apps/postings/) and the add-on's ledger,
or Adminium on its behalf, said no. Nothing was saved. `details.reason` says why:

| `reason` | Said by | Also in `details` |
|---|---|---|
| `out-of-stock`, `expired`, `needs-batch` | the add-on, on a ledger of stock | `ledger`, `posting`, `line`?, `path`?, `left`?, `item`? |
| `not-valid`, `inactive`, `void`, `empty`, `used-up`, `over-limit`, `needs-customer`, `refund-over`, `not-allowed` | the add-on, on a ledger of value | the same |
| `out-of-stock`, `over-limit` | the ledger's own cap or limit, when the add-on let the save through | `phase: "reverse"` when it was a give-back that would go below zero |
| `mapped-changed` | a column the open round read was changed | `posting`, `column` |
| `receipt-open` | a row with an open round was deleted, or a rule rows hold under was changed or removed | `posting`, `rows`? |
| `one-at-a-time` | a bulk edit, an undo, a form's child rows, a batch or an effect would have posted | `posting`?, `effect`? |
| `add-on-unavailable` | the add-on cannot be asked now, or the rule names something it does not have | `ledger`?, `posting`? |
| `card-pays-card` | a line of the same order forbids it | `posting` |
| `planner-failed`, `too-large`, `hooked`, `guarded` | a fault of the add-on's code or of the setup | `table`? — the cause is in the audit row `ledger.refused`, never in the reply |

`line` is the line's place among the lines handed over, and `path` its place in a create with
child rows. `left` (how much is left) and `item` (of what) are read from the add-on's own rows:
they are in the reply only for a caller who may read every table the action reads. A dry run
answers the same reasons in `postings[]` with `200`, and fails only for what is not a ledger's
refusal.
