---
title: Payments on your server
description: What a self-hosted server needs before customers can pay online — the pay address, the webhook, the proxy setting — and what happens when you restore a backup.
sidebar:
  order: 9
---

From Adminium 0.3.32. How to set payments up in the dashboard is in
[Take payments](/guides/take-payments/).

Online payments need two things from the internet: customers open the pay page on your server, and
Stripe or PayPal call your server back to say how a payment went. **Studio → Payments → Setup**
checks what it can from inside, under **Can customers reach this server?**, and names the first
thing that rules online payments out.

## What the check needs

| What | Why |
|---|---|
| A public address, saved as **Address in email links** in the Senders card | Pay links and the webhook address are built from it. |
| `https` | Pay pages and both services need it. |
| Not loopback, not a private or link-local address, not a `.local` name | Customers and the services must be able to reach it. |
| `ADMINIUM_NETWORK_FEATURES` not `off` | With network features off, no online payment starts. |
| Not the desktop app | The desktop app serves this computer only. |
| `ADMINIUM_TRUST_PROXY=on` when a proxy forwards requests | Otherwise every customer looks like the proxy, and the per-customer limits on pay pages count them all as one. |

A name that only your own network resolves can still pass these checks. What proves the server is
reachable is the first live webhook event arriving: the Setup card shows it.

When the check fails, live pay links stop opening and new ones are not made. Test links still open
for staff on their own address. Everything that needs no
internet keeps working: ways to pay by hand, recording payments, the card-terminal record. Payments
already on their way still finish.

## Where customers pay

**Studio → Payments → Pay page → Where customers pay** chooses the address in every pay link: your
staff address, or one of your customer addresses ([an app on its own domain](/self-hosting/app-domains/)). A customer address
is better when you would rather not show the staff address to the public. The webhook uses the same
address. Until you choose one, both use this server's public address (**Address in email links** in
Senders).

A customer address serves only what a customer needs. For payments that is `/pay/…` (the pay page,
its files and its own API) and `/api/v1/payments/webhook/…`. Your proxy must let both through.

## The webhook address

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

## Behind a proxy

Set `ADMINIUM_TRUST_PROXY=on` when Adminium runs behind Caddy, nginx or a load balancer. See
[Behind a reverse proxy](/self-hosting/reverse-proxy/).

A pay link carries its token in the path, `/pay/<token>`. Adminium leaves the token out of its own
request log. Your proxy's access log is yours: leave `/pay/` paths out of it, or keep that log
private, because a token there opens the pay page.

## The keys

Payment keys are saved per mode (test and live) and kept in the add-on's encrypted credentials in
the meta store, under the key derived from `ADMINIUM_SECRET`. Keep that secret with your backups:
without it the keys cannot be read, and you would paste them again.

Several Adminium processes can share one meta store. The safety check that finds payments whose
webhook went missing runs once per service and mode, whichever process gets it.

## Backups and restores

The meta store and your shop's database are usually backed up by different hands, at different
times. Payments are written so that a restore of either one does not lose or double a payment:

- **Your shop's database restored to an older point.** Payments written after that point are
  missing from your tables. Every night Adminium checks the live payments of the last 30 days, and
  flags any whose row is gone, voided or for another amount in **Activity**. It never writes. Record
  the missing ones again by hand, or restore the rows.
- **The meta store restored to an older point.** Payments that had finished read as open again.
  Adminium asks the service about them and finishes them again. This is safe because a payment
  written into your table carries the payment's own reference in a unique column: one already there
  is found and not written twice. Payments Adminium keeps itself live in the meta store, so the
  ones after the restore point are written again as they finish.

Test payments live in the meta store only and never touch your tables.

## See also

- [Environment variables](/self-hosting/env-vars/): `ADMINIUM_TRUST_PROXY`,
  `ADMINIUM_NETWORK_FEATURES`, `ADMINIUM_SECRET`.
- [An app surface on its own domain](/self-hosting/app-domains/).
- [Upgrades](/self-hosting/upgrades/): back up first.
