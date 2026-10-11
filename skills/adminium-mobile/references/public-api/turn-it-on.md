<!-- produced from apps/docs/src/content/docs/guides/public-api/endpoints-and-keys.md § Turn it on; do not edit -->

# Endpoints and keys: Turn it on

Two switches, and both must be on.

1. **On the server.** Set `ADMINIUM_PUBLIC_API_ORIGINS` and restart. It lists the exact
   origins browser pages may call from, such as `https://shop.example.com`. Add `self` to
   let pages this instance serves itself call it (the `/api-docs` playground is one). With
   the variable unset, the public routes are not served at all.
2. **In Workspace settings.** The **Public API** card has a **Public API** switch. It
   applies the moment you click it. Off, every key stops working at once and nothing is
   deleted.
