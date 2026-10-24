<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

```json
{ "ref": "offer_until", "type": "timestamptz", "nullable": true,
  "rules": { "stamp": {
    "set": { "addMinutes": { "hours": { "table": "settings", "column": "offer_hours" },
                             "notAfter": { "column": "doors_at", "via": "event_id" } } },
    "on": { "column": "status", "values": ["offered"] } } } }
```
