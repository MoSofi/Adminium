<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Sample data; do not edit -->

# Manifest spec: Sample data

`sampleData` points at a file of demo rows inside the package:

```json
"sampleData": { "file": "seeds/visits.sample.json" }
```

The file must be in `seeds/` and end in `.json`. `skipWhenShared` (`{ "table", "skip": [1–50
table refs] }`) leaves the listed tables' sample rows out when `table` is a [shared
table](https://docs.adminium.dev/reference/manifest/#shared-tables) another installed app uses and it already holds real rows (rows no app's
sample added): a venue's real menu never gains sample dishes, nor sample orders of them. The list
must include every table that links to a skipped one. After installing, the operator can add the
sample data in one step and later remove it. Removal shows a preview first. It keeps every sample row the
operator's own records still point at and, if they choose, the rows they have changed since.
