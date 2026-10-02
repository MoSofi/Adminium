<!-- produced from apps/docs/src/content/docs/projects/page-files.md § A schema file; do not edit -->

# Page files: A schema file

One file per database, holding the customizations that would otherwise only be
in Adminium's tables:

```json title="schema/main.json"
{
  "$schema": "../node_modules/@adminiumjs/adminium/schemas/schema.json",
  "overrides": [
    { "table": "main.contacts", "op": "table.label", "value": { "label": "Customers" } },
    { "table": "main.contacts", "column": "mrr_amount", "op": "column.label", "value": { "label": "MRR" } },
    { "table": "main.contacts", "column": "notes", "op": "column.hidden", "value": { "hidden": true } },
    { "table": "main.audit_rows", "op": "table.exclude", "value": { "excluded": true } }
  ]
}
```

| `op` | `value` |
|---|---|
| `table.label` | `label`, and optionally `labelPlural` and `icon` |
| `table.exclude` | `excluded` |
| `table.keyField` | `column` |
| `column.label` | `label` |
| `column.semanticType` | `semanticType`, and `currency` for money |
| `column.enumLabels` | `labels` per value, and optionally `tones` |
| `column.pii` | `masked`, and optionally `kind` |
| `column.hidden` | `hidden` |
| `relation.add` | `fromColumn`, `toTable`, `toColumn`, `cardinality` |
| `relation.remove` | `fromColumn`, `toTable` |
| `relation.label` | `fromColumn`, `label` |

A row the [LLM assist](https://docs.adminium.dev/guides/llm-assist/) proposed and you accepted carries
`"origin": "llm"` and its `confidence`. The masks Adminium proposes by itself
are **not** written: every install classifies its own schema and derives them
again, so they would be noise in a diff. Your own corrections, including one
that turns a proposed mask off, are written.

`"status": "disabled"` keeps a row in the file while turning it off — the same
thing as switching it off in Studio.
