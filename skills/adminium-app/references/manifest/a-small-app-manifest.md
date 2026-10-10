<!-- produced from apps/docs/src/content/docs/reference/manifest.md § A small app manifest; do not edit -->

# Manifest spec: A small app manifest

```json
{
  "manifestVersion": 1,
  "kind": "app",
  "key": "visits",
  "name": "Visits",
  "version": "1.0.0",
  "publisher": { "id": "adminium", "name": "Adminium" },
  "license": "AGPL-3.0-only",
  "description": { "key": "mft.visits.desc", "fallback": "Book and track client visits." },
  "categories": ["operations"],
  "compatibility": { "minAdminiumVersion": "0.3.24" },
  "requiredSchema": {
    "prefixed": true,
    "tables": [
      {
        "ref": "visits",
        "label": { "en-US": "Visit", "de-DE": "Besuch" },
        "labelPlural": { "en-US": "Visits", "de-DE": "Besuche" },
        "keyField": "client",
        "columns": [
          { "ref": "id", "type": "int", "role": "pk" },
          { "ref": "client", "type": "text", "maxLength": 80 },
          { "ref": "starts_at", "type": "timestamptz" },
          { "ref": "status", "type": "enum", "enum": ["booked", "done", "cancelled"], "default": "booked" }
        ]
      }
    ]
  },
  "pages": [
    {
      "ref": "visits-calendar",
      "template": "page-calendar",
      "title": { "key": "mft.visits.page.calendar", "fallback": "Calendar" },
      "nav": { "group": "records", "icon": "calendar-days", "order": 1 },
      "bindings": { "rows": "visits" }
    }
  ],
  "frontends": [{ "side": "staff", "kind": "spa", "entry": "index.html" }]
}
```
