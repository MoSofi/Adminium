<!-- produced from apps/docs/src/content/docs/guides/take-payments.md § Disputes; do not edit -->

# Take payments: Disputes

When a customer disputes a payment with their bank, the payment is marked **Disputed** and the
people who set up payments are told. Answer the dispute in the Stripe or PayPal dashboard. While it
is open, the payment cannot be refunded.

When the dispute ends, Adminium records how:

- **Won:** the payment says the dispute was won, and nothing else changes.
- **Lost:** the money went back to the customer. It is recorded on the payment as a line of its own,
  "Dispute lost — €120.00 returned to the customer", like a refund: the balance opens again by that
  amount (for a live payment), **Refund…** can give only what is left, the people who set up payments
  are told, and Activity flags it for a look. The invoice's status changes only through the
  "refunded in full" value you mapped.

These notices go out in test mode too, marked "Test", so you can see them while you set up.
