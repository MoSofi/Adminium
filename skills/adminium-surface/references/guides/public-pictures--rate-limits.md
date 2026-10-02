<!-- produced from apps/docs/src/content/docs/guides/apps/public-pictures.md § Rate limits; do not edit -->

# Pictures on public pages: Rate limits

| What | Limit |
|---|---|
| One visitor | 1,200 pictures a minute, counted before the key is looked up |
| The whole key | 6,000 pictures a minute, every visitor together. A `304` does not count. |

Over a limit, the answer is `429` `PUBLIC_RATE_LIMITED` with `Retry-After`. An address that keeps
naming keys that do not exist is refused before the lookup. See the
[REST API reference](https://docs.adminium.dev/reference/rest-api/) and the [errors reference](https://docs.adminium.dev/reference/errors/).
