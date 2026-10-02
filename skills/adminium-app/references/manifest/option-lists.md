<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Option lists; do not edit -->

# Manifest spec: Option lists

`optionLists` ships lists of answers a column can name with `options: { "list": "<name>" }`. It is
an object keyed by kebab-case list name.

```json
"optionLists": {
  "zones": {
    "label": { "en-US": "Zones", "de-DE": "Bereiche" },
    "values": [
      { "value": "Window", "label": { "en-US": "Window", "de-DE": "Fenster" } },
      { "value": "Patio", "tone": "info" }
    ]
  }
}
```

Each list has a `label` and 1–500 `values`, each with a `value` (1–256 characters) and an optional
`label` and `tone`. A list is installed once as `<key>-<name>` (`pos-zones`). The operator can edit
it like any other list, so a later version never overwrites it, and a list of that key someone
already made is left alone.
