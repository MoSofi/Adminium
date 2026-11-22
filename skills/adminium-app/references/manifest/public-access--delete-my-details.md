<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Delete my details; do not edit -->

# Manifest spec: Public access — Delete my details

### Delete my details

`forget` on an identity entry that signs people in by email lets a person delete their details
(`DELETE /api/v1/public/account`, with a code confirmed or a link pressed in the last ten minutes,
else `403` `PUBLIC_CODE_STEP_UP`).

```json
"forget": { "columns": ["name", "email", "phone"], "stamp": "forgotten_at", "links": true }
```

`columns` lists 1–16 nullable columns of the person's row that are emptied, the address they sign
in with among them; never the key, nor a column Adminium decides. `stamp` is a nullable
`timestamptz` written with the time they were forgotten. With `"links": true`, every own link of the
rows the person holds is renewed first and the sessions those links opened are ended (a device
learns it by the `x-adminium-session-ended: forgotten` header, once); if that cannot be done,
nothing is forgotten. A message about a forgotten person is not sent, even one queued before they
asked. Every session the person holds can also be ended without forgetting anything:
`POST /api/v1/public/session/revoke-all`.

With `"copies": true` (Adminium 0.3.71 or later), the same delete also empties the person's copies
that [`people[].copies`](https://docs.adminium.dev/reference/manifest/#people) declares with a `via` link to them, in the transaction that empties
their own row. A row is found by that link alone, so a row that merely holds the same typed address
stays as it is. A table with `keep` stays whole. The rows are written directly: no state moves, no
booking is judged again, and no mail or rule runs. The manifest is refused when no copy of the person
has a `via`.
