<!-- produced from apps/docs/src/content/docs/reference/errors.md § Public API codes; do not edit -->

# Error codes: Public API codes

| Code | Status | When | params |
|---|---|---|---|
| `PUBLIC_API_DISABLED` | 503 | The Public API switch is off for this instance. | none |
| `PUBLIC_KEY_INVALID` | 401 | No key, or a key that is unknown, revoked or expired. | none |
| `PUBLIC_ORIGIN_REFUSED` | 403 | A browser key from an origin not allowed, or a server key used from a browser. | none |
| `APP_DISABLED` | 503 | The app that made this key is switched off. | none |
| `SURFACE_OFF` | 503 | The app is on, but the side of it this key serves is switched off. | none |
| `PUBLIC_STAFF_REQUIRED` | 403 | A kiosk's key used without its staff member signed in on that screen. | none |
| `PUBLIC_KEY_OFF` | 503 | A key the app switches in its settings row is off. | none |
| `PUBLIC_RATE_LIMITED` | 429 | Over a rate limit, or out of [guesses at a typed code](https://docs.adminium.dev/reference/errors/#a-typed-code). `Retry-After` says when. | none |
| `PUBLIC_PROOF_REQUIRED` | 403 | The human check is missing, wrong, expired or used, or a batch of creates on an entry that asks for one. | none |
| `PUBLIC_REF_NOT_FOUND` | 404 | No such endpoint, a method the key does not have, a row outside the endpoint's filter or someone else's, or an unknown shared link. All look the same on purpose. | none |
| `PUBLIC_ACTION_NOT_ALLOWED` | — | Listed for the client, not sent by this server: a method an endpoint lacks is `PUBLIC_REF_NOT_FOUND`. | — |
| `PUBLIC_QUERY_REFUSED` | 400 | A read the endpoint does not take. See [below](https://docs.adminium.dev/reference/errors/#a-refused-query). | `parameter` for U+0000 only |
| `PUBLIC_UPSTREAM_UNAVAILABLE` | 503 | The database cannot be reached, is paused, or a document could not be drawn. | none |
| `PUBLIC_SWITCHED_OFF` | 403 | The app switched this off in its settings. See [below](https://docs.adminium.dev/reference/errors/#switched-off). | none |
| `PUBLIC_WRITE_REFUSED` | 400, or 409 | A write refused. See [below](https://docs.adminium.dev/reference/errors/#a-refused-write). | several shapes |
| `PUBLIC_WRITE_REJECTED` | 400 | A project hook refused the write. Its `message` is the project's own text, meant for people. | none |
| `PUBLIC_SLOT_FULL` | 409 | The time asked for has no room left. | `column` |
| `PUBLIC_SLOT_BUSY` | 409 | The write lost a race. Send it again in a moment. | none, or the row's place |
| `PUBLIC_SOLD_OUT` | 409 | What a line asks for is sold out. | `column`, and the row's place |
| `PUBLIC_NO_ROOM` | 409 | No room of the type asked for is free on one of the nights. | `column`, `night` |
| `PUBLIC_TOO_EARLY` | 409 | The guest's own row is not yet inside the window its change needs. | `at`, `from` |
| `PUBLIC_TOO_LATE` | 409 | Too close to the time for this change online. | `at` when known |
| `PUBLIC_PRICE_CHANGED` | 409 | The write came to another price than the one the guest was shown. Nothing was written. | `total`, `lines` |
| `PUBLIC_LIMIT_REACHED` | 409 | As many as may be made online have been made. See [below](https://docs.adminium.dev/reference/errors/#limits-reached). | none |
| `PUBLIC_CLAIM_NO_MATCH` | 403 | A lookup that matched no row. | none |
| `PUBLIC_CLAIM_UNAVAILABLE` | 403 | The key has no claim or identity for this, or the identity declares no "delete my details". | none |
| `PUBLIC_CLAIM_LEVEL` | 403 | The session found the person but has not confirmed the emailed code, on an entry that needs it. | none |
| `PUBLIC_CLAIM_NO_EMAIL` | 409 | The person has no address a code could go to. | none |
| `PUBLIC_CLAIM_LOCKED` | 403 | Too many wrong codes for this person today. | none |
| `PUBLIC_CODE_TOO_SOON` | 429 | A code went a moment ago. | `retryAfter` |
| `PUBLIC_CODE_LIMIT` | 429 | This session has asked for as many codes as it may. | none |
| `PUBLIC_CODE_LOCKED` | 429 | The last code died of wrong tries; the session waits. | `retryAfter` |
| `PUBLIC_CODE_WRONG` | 403 | Not the code. | `triesLeft` |
| `PUBLIC_CODE_EXPIRED` | 410 | No code is open: expired, used or replaced. | none |
| `PUBLIC_CODE_STEP_UP` | 403 | Changing the address or deleting one's details needs a code confirmed, or a link pressed, in the last few minutes. | none |
| `PUBLIC_CODE_UNAVAILABLE` | 503 | No email can go from this server right now. See [below](https://docs.adminium.dev/reference/errors/#no-email-can-go). | none |
| `PUBLIC_EMAIL_CHANGE_LIMIT` | 429 | The address was changed today already. | none |
| `LINK_EXPIRED` | 410 | A sign-in link or a shared link that opens nothing any more: used, expired, stopped or given a new code. | none |

The sign-in codes are covered step by step in [An app's public
access](https://docs.adminium.dev/guides/apps/public-access/#the-emailed-code). The rest of this section takes the write
codes one at a time.
