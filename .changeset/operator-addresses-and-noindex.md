---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

An operator can now give an instance its addresses: `ADMINIUM_PUBLIC_ORIGIN` (their address for it) and `ADMINIUM_OPERATOR_DOMAINS` (the person's own domains they verified, plain lower-case host names). The instance then answers on those names only (421 on any other, before any route is reached; behind a trusted proxy, the forwarded name is the one checked). The address in email links becomes `https://` and the first listed domain, else `ADMINIUM_PUBLIC_ORIGIN`: it is written at every boot, Studio shows it read-only marked "Set by the operator", and `PUT /api/v1/settings/email` refuses a change with `SET_BY_OPERATOR` (its reply now carries `locks.publicOrigin`). In trial mode, every response carries `X-Robots-Tag: noindex, nofollow`, every page the robots meta tag, `/robots.txt` disallows everything on every host, pay pages and inbound payment webhooks answer 403, and the websites that may frame a form must be listed domains (the last also in the hosted profile). Without these variables nothing changes.
