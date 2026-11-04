<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — The design question; do not edit -->

# Manifest spec: Add-on manifests — The design question

### The design question

An add-on that keeps designs declares `addOn.checker` and provides the contract `design-check`
(`provides: [{ "contract": "design-check", "version": 1, "server": "dist/check.js" }]`). Adminium
reads what the checker names, asks the add-on's code, and holds each line to the answer (see
[A design an add-on checks](https://docs.adminium.dev/reference/manifest/#a-design-an-add-on-checks)). From Adminium 0.3.43.

```json
"checker": {
  "design": "designs",
  "reads": [
    { "id": "ready", "table": "ready_designs", "by": { "column": "id", "from": "design.ready_id" } },
    { "id": "parts", "table": "ready_parts", "by": { "column": "ready_id", "from": "ready.id" } },
    { "id": "base", "table": "bases", "by": { "column": "id", "from": "design.base_id" } },
    { "id": "areas", "table": "base_areas", "by": { "column": "base_id", "from": "base.id" } }
  ]
}
```

| Field | Rule |
|---|---|
| `design` | The add-on's own table of designs: what a line's design link points at. |
| `reads` | Up to 8 keyed reads of its own tables, in order: `{ "id", "table", "by": { "column", "from" } }`. `from` is `design.<column>` (of the line's design row) or `<id>.<column>` of an earlier read; a read takes the rows whose `column` holds one of those values. `design` is no read's id. |

For each line, at most 400 rows in all are read; past that the line is refused by name. Every
read is keyed: there is no read of a whole table. The add-on's settings row is handed in too. See
[Checking a design](https://docs.adminium.dev/guides/add-ons-with-tables/#checking-a-design) for the contract and its
testing kit.
