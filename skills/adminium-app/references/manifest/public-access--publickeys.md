<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — publicKeys; do not edit -->

# Manifest spec: Public access — publicKeys

### publicKeys

`publicKeys` declares browser keys besides `customer`, keyed by a kebab-case name of up to 32
characters. Such a key is never published on the customer side. The staff side is handed it, in
its `surface-config.json` under `publicKeys`, only when the person signed in holds the key's role.
Every request on the key must then carry that same staff sign-in, from the same origin, with the
CSRF token on a write. A token copied out of the page opens nothing on its own.

```json
"publicKeys": {
  "kiosk": { "requiresStaff": { "role": "kiosk" },
             "enabledBy": { "table": "settings", "column": "kiosk_on" } }
},
"roles": [
  { "key": "kiosk", "name": "Check-in tablet", "screensOnly": true, "permissions": ["app:@:staff"] }
],
"publicAccess": [
  { "table": "patients", "key": "kiosk", "methods": ["GET"], "select": ["name"],
    "claim": { "match": ["surname", "date_of_birth"] } },
  { "table": "appointments", "key": "kiosk", "methods": ["GET", "PATCH"],
    "claimedBy": { "table": "patients", "column": "patient_id" },
    "filters": [{ "column": "starts_at", "op": "today" }],
    "select": ["id", "starts_at", "status"],
    "writable": ["status"], "writableValues": { "status": ["checked_in"] },
    "writableWhen": { "status": ["booked"], "starts_at": { "within": 60 } } }
]
```

| Field | Required | Rule |
|---|---|---|
| `requiresStaff` | yes, but see below | `{ "role" }`: one of the app's roles. It must be `screensOnly`, with no `cloneFrom` and no grant but `app:@:staff`, because the screen stands where anyone can walk up to it. |
| `enabledBy` | no | `{ "table", "column" }`: a bool of the settings table. While it is false the key answers `PUBLIC_KEY_OFF`. Read as `requireSetting` is, and trusted for 15 seconds. |
| `peak` | no | `{ "reads", "writes" }`: the key's own budget a minute at the app's peak (a show going on sale), from Adminium's own 3,000 reads and 300 writes up to five times that. Each visitor still gets a twelfth. Written at install, and changed by an update. |

`customer` is declared here only for its `peak`: `"customer": { "peak": { "reads": 9000, "writes":
600 } }`. At least one entry must name every other key. A request without
the right staff sign-in is refused with `PUBLIC_STAFF_REQUIRED`; a super-admin is refused too.
Claims through a staff-bound key ask no proof, and their sessions last 3 minutes. See
[A kiosk](https://docs.adminium.dev/guides/apps/public-access/#a-kiosk).

A key with no `requiresStaff` is a **share key**: nobody signs it in, so it opens one row by its
[token](https://docs.adminium.dev/reference/manifest/#a-persons-own-rows) to whoever holds the link, and reads nothing else. Its identity entry
claims `by: "token"`, and every entry on it is `GET` only, reaching the rest through
`visibleWith`:

```json
"publicKeys": { "handover": {} },
"publicAccess": [
  { "table": "projects", "key": "handover", "methods": ["GET"], "select": ["name", "handover_file"],
    "claim": { "by": "token", "column": "share_token", "expires": "share_expires_on", "stopped": "share_stopped" },
    "files": ["handover_file"] },
  { "table": "deliverable_versions", "key": "handover", "methods": ["GET"], "select": ["v", "file"],
    "visibleWith": { "table": "projects", "via": "project_id" }, "files": ["file"] }
]
```
