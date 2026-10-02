<!-- produced from apps/docs/src/content/docs/guides/apps/settings.md § Addresses and domains; do not edit -->

# An app's settings page: Addresses and domains

Each side shows its address, with **Copy**: its domain when one is attached, otherwise
`/apps/<key>/staff/` or `/apps/<key>/customer/` on this server. The staff side also has
**Add a domain**: type a host such as `till.example.com` and **Add**, and that host opens the
staff screens. The customer side has **Preview**, which opens the
customer screens in a new tab.

To give the customer side a domain, use the **Domains** card on **Studio → Hosted apps**: enter
the host, pick the surface, and **Save domains**. A host already mapped to another app is refused,
and so is the host you are using to reach Studio. DNS, the reverse proxy and certificates are set
up as in [An app surface on its own domain](https://docs.adminium.dev/self-hosting/app-domains/).

### What a customer domain serves

A customer domain is the business's public address, so it serves nothing of the admin panel:

- the app's customer pages, at `/`, with deep links;
- the public API, `/api/v1/public/*`, which those pages call;
- the app's own customer assets under `/apps/<key>/customer/`.

Everything else answers `404`: the sign-in pages, the rest of `/api`, other apps' `/apps/…`
paths. A browser that loads one of those addresses gets a plain **Page not found** page, "There's
nothing at this address. Check the link and try again.", in the visitor's language; a script gets
the JSON error.

A staff domain works differently, because staff have to sign in there. It keeps the dashboard's
sign-in pages; see [what a mapped staff domain does about sign-in](https://docs.adminium.dev/self-hosting/app-domains/#what-a-mapped-staff-domain-does-about-sign-in).
