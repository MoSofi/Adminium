<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § Origins; do not edit -->

# An app's public access: Origins

The public API exists only when `ADMINIUM_PUBLIC_API_ORIGINS` is set; unset, its routes are not
there at all. A browser key is accepted only from the origins that variable allows:

- **`self`** allows pages this server serves itself: the customer screens at `/apps/<key>/customer/`
  and on a domain attached to them. Without `self`, the app's own pages cannot call the API.
- **Other origins**, listed exactly, allow pages hosted somewhere else.

```bash
ADMINIUM_PUBLIC_API_ORIGINS='self,https://shop.example.com'
```

See [`ADMINIUM_PUBLIC_API_ORIGINS`](https://docs.adminium.dev/self-hosting/env-vars/#adminium_public_api_origins) for the
rules that come with it, including the reverse-proxy setting it needs.
