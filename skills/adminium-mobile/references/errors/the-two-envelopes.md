<!-- produced from apps/docs/src/content/docs/reference/errors.md § The two envelopes; do not edit -->

# Error codes: The two envelopes

### Staff and API-key routes

Everything under `/api/v1/` except the public API answers a refusal with one shape:

```json
{
  "error": {
    "code": "CAPACITY_FULL",
    "message": "That is sold out.",
    "requestId": "req_8f2a91cd",
    "details": { "column": "ticket_type_id", "rule": 0, "kind": "parent", "row": 0, "pool": { "key": "3" }, "left": 1 }
  }
}
```

`requestId` is the same id the server log carries for the request. `details` is there only when
the refusal has something to say, and its keys are listed with each code below.

### The public API

`/api/v1/public/*` answers with a smaller shape, with no request id and no details:

```json
{ "error": { "code": "PUBLIC_SOLD_OUT", "message": "That is sold out.", "params": { "column": "ticket_type_id" } } }
```

`params` is there only when the code has something to add, and says no more than the page
already knows: the column a guest filled in, the time they picked, their own row's place in the
request. It never says how many places are left, what another row holds, or which constraint
refused. `@adminiumjs/public-client` throws a `PublicApiError` with `code`, `status`, `params` and
`retryAfterSeconds`; a request that never got an answer is `PUBLIC_NETWORK_UNAVAILABLE`, status
`0`, which the server itself never sends.

### Headers a page reads

| Header | When | What it says |
|---|---|---|
| `Retry-After` | Every `429` `PUBLIC_RATE_LIMITED`; a `503` `PUBLIC_UPSTREAM_UNAVAILABLE` for a picture being prepared (`1`) | Seconds to wait before asking again. |
| `x-adminium-session-ended` | The first request after the session the page sent was ended from elsewhere | `elsewhere`: the person pressed "Sign out everywhere" on another device. `forgotten`: the person deleted their details, or their own links were stopped as part of it. |

The session-ended header is sent once, only to the holder of that session's token and on its own
key; the request itself goes on with no session. After that the token is simply unknown. Both
headers are exposed to cross-origin pages, so `headers.get()` reads them, and
`client.sessionEnded()` returns the reason.
