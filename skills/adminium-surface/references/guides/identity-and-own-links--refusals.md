<!-- produced from apps/docs/src/content/docs/guides/apps/identity-and-own-links.md § Refusals; do not edit -->

# Guests, their details and their own links: Refusals

| Code | Status | When |
|---|---|---|
| `PUBLIC_WRITE_REFUSED` | 400 | An address that is not one (`params.reason` `format`); a value that is not plain text (`params.column`); a change through an own link naming an address it was not opened for. |
| `PUBLIC_QUERY_REFUSED` | 400 | A filter or sort by a withheld column. |
| `PUBLIC_CLAIM_LEVEL` | 403 | A lookup session on a verified read, sign-out everywhere or delete. |
| `PUBLIC_CLAIM_UNAVAILABLE` | 403 | Sign-out everywhere or delete from a row's own link, or on a key with no `forget`. |
| `PUBLIC_CODE_STEP_UP` | 403 | Delete my details without a mailbox proved in the last 10 minutes. |
| `PUBLIC_REF_NOT_FOUND` | 404 | A session-only read with no session; a new link asked for a row that is not the person's, or by a session that may not. |
| `LINK_EXPIRED` | 410 | An own link stopped or past its end. |
| `PUBLIC_LIMIT_REACHED` | 409 | Over `perValue`, `perIpHour`, 5 new links a day for one row, or 5 resent links a day to one mailbox. |
| `PUBLIC_WRITE_REFUSED` | 409 | A delete whose own links could not all be stopped; a new link for a row with no code, or one that does not hold the entry's `newLink.when`. |
| `PUBLIC_CODE_UNAVAILABLE` | 503 | A new link that cannot be emailed. It is checked first, so the old link is kept. |

Every code is in the [errors reference](https://docs.adminium.dev/reference/errors/), and every route in the
[REST API reference](https://docs.adminium.dev/reference/rest-api/).
