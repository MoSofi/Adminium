<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § Rate limits; do not edit -->

# An app's public access: Rate limits

| What | Limit |
|---|---|
| Each endpoint the install makes | 60 requests a minute per visitor |
| A claim | 5 tries a minute per visitor, and 60 a minute across the whole key |
| Asking for a code and typing one | 10 a minute per session, never counted across the whole key |
| A claim at a kiosk | 30 a minute per staff sign-in, and the whole key's 60 |
| A challenge for the human check | Counted per visitor as a read, never across the whole key |

Claims have their own count across the key, apart from writes, so a flood of guesses cannot stop
bookings. Codes are counted per session, so a flood of strangers cannot stop people already found
from confirming. The limits every browser key has on top of these, and the `429` answer, are in
[Rate limits](https://docs.adminium.dev/guides/public-api/endpoints-and-keys/#rate-limits).
