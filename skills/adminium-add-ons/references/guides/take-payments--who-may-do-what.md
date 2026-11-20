<!-- produced from apps/docs/src/content/docs/guides/take-payments.md § Who may do what; do not edit -->

# Take payments: Who may do what

| Permission | What it allows |
|---|---|
| **Set up payments** | Everything on **Studio → Payments**: keys, webhooks, ways to pay, what can be paid, the pay page. Open test links. |
| **See payment activity and export it** | The **Activity** tab, read-only, and its CSV export. |
| **Give refunds** | Refund a payment from a record's Payment panel or from Activity. Only a signed-in person, never an API key. |

Making pay links and recording payments by hand follow the record: whoever may edit the record may
do it.

The Payment panel follows what a person may read of the record. Someone whose role reads the record
but not its total, or not what is due (a packer who sees an order's items and address, and nothing of
what it cost), gets no Payment panel on it and no paid or unpaid badge beside it in a list, and may
not record a payment by hand on it.
