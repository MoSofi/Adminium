<!-- produced from apps/docs/src/content/docs/reference/manifest.md § A self-made app — `provenance`; do not edit -->

# Manifest spec: A self-made app — `provenance`

### `provenance`

Where and when the file was saved:

```json
"provenance": {
  "lineage": "k3Vx9_Qp2mL8",
  "savedAt": "2026-11-01T09:30:00Z",
  "adminiumVersion": "0.3.49",
  "label": "Fernhill main",
  "workspaces": ["Fernhill Coffee"]
}
```

| Field | Required | Rule |
|---|---|---|
| `lineage` | yes | 8–64 letters, digits, `-` or `_`: a random id drawn at the app's first save and kept for every later version. Never an id of the server. |
| `savedAt` | yes | An ISO date-time with its offset. |
| `adminiumVersion` | yes | The Adminium that saved it. |
| `label` | no | 1–120 characters: the name the person gave the place it was made. Shown on the review ("Made at Fernhill main"). |
| `workspaces` | no | Up to 32 names of the [workspaces](https://docs.adminium.dev/guides/workspaces/) its database was in. Shown as names only. |

The lineage is how a server tells one app from another under the same key. A newer version of the
same lineage installs as an update; a file of another lineage under a key this server already has
is refused (`LINEAGE_DIFFERS`), and a file is never installed back onto the database it was saved
from (`SAVED_FROM_HERE`).
