<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Pages — navGroups; do not edit -->

# Manifest spec: Pages — navGroups

### navGroups

`navGroups` names the headings inside the app's sidebar section. Up to 12.

```json
"navGroups": [
  { "key": "manage", "label": { "en-US": "Manage", "de-DE": "Verwalten" }, "order": 1 },
  { "key": "records", "label": { "en-US": "Records", "de-DE": "Aufzeichnungen" }, "order": 2 }
]
```

Each group has a kebab-case `key`, a keyed [label](https://docs.adminium.dev/reference/manifest/#conventions) (must include `en-US`) and an
integer `order`. A page whose `nav.group` is one of these keys is listed under that heading, in
`nav.order`. A page whose group is not declared (an Overview, say) is listed first, with no
heading.
