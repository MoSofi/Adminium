<!-- produced from apps/docs/src/content/docs/reference/errors.md § Staff and API-key write codes — A refused price; do not edit -->

# Error codes: Staff and API-key write codes — A refused price

### A refused price

`409 ADJUST_REFUSED` — a save moved an order's price and something about it does not stand. From
Adminium 0.3.19. `details.reason` says what, `details.column` the field it is about:

| `reason` | Means | Also in `details` |
|---|---|---|
| `unknown`, `expired`, `inactive`, `void`, `not-yet`, `used-up`, `over-limit` | The typed code does not stand, and why. | — |
| `needs-minimum` | The code needs a larger order. | `amount` |
| `not-for-these-items` | The code is for nothing on the order. | — |
| `needs-customer` | The code is kept for one use each: name the customer first. | — |
| `over-ceiling` | A reduction by hand is more than its giver may take off. | `max` |
| `not-allowed` | Somebody else's reduction, or a refund that already stands, is not this writer's to change. | — |
| `frozen` | The order's price stands. | — |
| `refund-over` | More returned than was bought, or nothing left to give back. | `max` |

On the public API a typed code is refused as [`PUBLIC_WRITE_REFUSED`](https://docs.adminium.dev/reference/errors/#a-refused-write) on its
field, with one of four reasons — `unknown`, `needs-minimum` (with `amount`), `not-for-these-items`,
`needs-sign-in` — and only `unknown` counts as a wrong guess. Every other reason above leaves as
`unknown`: a reply never says a code ran out, ended, or exists for somebody else.
