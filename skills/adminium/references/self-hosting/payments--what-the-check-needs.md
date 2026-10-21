<!-- produced from apps/docs/src/content/docs/self-hosting/payments.md § What the check needs; do not edit -->

# Payments on your server: What the check needs

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
