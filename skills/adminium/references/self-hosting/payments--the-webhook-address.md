<!-- produced from apps/docs/src/content/docs/self-hosting/payments.md § The webhook address; do not edit -->

# Payments on your server: The webhook address

Each payment service and mode has its own address:

```text
https://<your pay address>/api/v1/payments/webhook/<service>/<mode>
```

`<service>` is the add-on (`payments-stripe` or `payments-paypal`) and `<mode>` is `test` or
`live`. Copy it from the service's card on the Setup tab rather than typing it.

- **PayPal sends webhooks only to port 443.** Use an address without a port.
- **Keep the server's clock right.** A webhook signature carries a time, and Stripe refuses one more
  than five minutes off. The Setup tab warns when this server's clock is more than a minute away
  from the service's. Run NTP.
- **When you change the address**, Studio warns you and names the webhook addresses to update at
  Stripe and PayPal. Until you do, payments are still found by Adminium's own checks, but late.

Adminium answers a webhook at once and does the work in a job. An event that is not about one of
your payments (Stripe sends every event on the account, including your other software's) is
answered and dropped.
