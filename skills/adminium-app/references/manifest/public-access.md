<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access; do not edit -->

# Manifest spec: Public access

`publicAccess` says what the app's public screens may do. Each entry becomes an endpoint of the
[public API](https://docs.adminium.dev/guides/public-api/endpoints-and-keys/) on the real table, served through one of the
app's browser keys and marked as the app's: switching the app off stops it and uninstalling
removes it. Up to 64 entries.

An entry is served through the app's `customer` key unless it names another in `key`. The install
creates one key for `customer` and one for each name in [`publicKeys`](https://docs.adminium.dev/reference/manifest/#publickeys). A key the
operator revoked is not made again by an update.

Every update takes back what its version no longer declares: each of the app's keys loses the
entries dropped (the `customer` key is kept, holding nothing if nothing is left), and a key whose
name the version no longer lists in `publicKeys` is revoked. What a version adds — an entry, a key,
or a staff screen's key turned into a shared link's — is given only when the operator allows it on
the update's check, which sends `"publicAccess": true` to `POST /api/v1/apps/{key}/update`.

```json
"publicAccess": [
  { "table": "booking_rules", "methods": ["GET"], "select": ["opens", "closes", "slot_minutes"] },
  { "table": "reservations", "kind": "availability", "methods": ["GET"] },
  { "table": "reservations", "methods": ["POST"],
    "select": ["id", "code", "starts_at", "status"],
    "writable": ["party_size", "starts_at", "name", "mobile", "email"],
    "defaults": { "status": "confirmed", "channel": "online" },
    "confirm": { "template": "booking-confirmation", "to": "email", "code": "code",
                 "when": "starts_at", "link": "manage?code={code}" } },
  { "table": "reservations", "methods": ["GET", "PATCH"],
    "claim": { "match": ["code", "mobile"] },
    "writable": ["starts_at", "party_size", "status"] }
]
```
