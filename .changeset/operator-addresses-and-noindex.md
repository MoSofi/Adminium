---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

An operator can now give an instance its addresses. With `ADMINIUM_PUBLIC_ORIGIN` or `ADMINIUM_OPERATOR_DOMAINS` set, on any server, the instance answers only on that origin's host and the listed domains: any other `Host` gets 421 before a route is reached, and behind a trusted proxy the forwarded name is the one checked. `/api/v1/healthz` and `/api/v1/readyz` still answer on every host, for a container's health check. The address in email links becomes `https://` and the first listed domain, else `ADMINIUM_PUBLIC_ORIGIN`: it is written at every boot, Studio shows it read-only marked "Set by the operator", `PUT /api/v1/settings/email` refuses a change with `SET_BY_OPERATOR` (its reply now carries `locks.publicOrigin`), and the server no longer learns another from a browser. Only listed domains can be mapped to an app's side or the add-on pages. In trial mode, every response carries `X-Robots-Tag: noindex, nofollow`, every page the robots meta tag, `/robots.txt` disallows everything on every host, pay pages and inbound payment webhooks answer 403, and the websites that may frame a form must be listed domains (the last also in the hosted profile). Without these variables nothing changes.
