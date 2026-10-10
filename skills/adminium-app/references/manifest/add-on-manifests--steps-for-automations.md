<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — Steps for Automations; do not edit -->

# Manifest spec: Add-on manifests — Steps for Automations

### Steps for Automations

`addOn.steps` gives the owner's rules up to 8 steps of the add-on's own. A step is a **named
write of one row** of one of the add-on's tables: Adminium writes the row through the same door
as a rule's own "create a record", so the table's column rules, its ledgers and the add-on's
outbox do the rest. No code of the add-on runs in a rule.

```json
"steps": [{
  "key": "issue-voucher",
  "name": { "en-US": "Issue a voucher", "…": "…" },
  "does": { "en-US": "Sends a voucher to one person", "…": "…" },
  "inputs": [
    { "key": "to", "kind": "email", "required": true, "label": { "en-US": "Send to", "…": "…" } },
    { "key": "worth", "kind": "choice", "required": true, "label": { "…": "…" },
      "options": [{ "value": "percent", "label": { "…": "…" } }] }
  ],
  "writes": { "table": "vouchers", "values": {
    "holder_email": { "input": "to" }, "worth": { "input": "worth" },
    "note": { "text": "From a rule" }, "issued_note_at": { "token": "now" } } }
}]
```

| Field | Rule |
|---|---|
| `key` | Kebab-case, unique among the add-on's steps. A rule names the step by it. |
| `name`, `does`, each `label` | A text in every one of the eight languages (60, 160 and 60 characters). |
| `inputs` | Up to 8. `kind` is `text`, `email`, `number`, `choice` (with `options`) or `record` (with `table`: a row of one of the add-on's tables is picked, and its key is the value). `required` makes the rule unfinished until it is filled. |
| `writes.table` | One of the add-on's own tables. |
| `writes.values` | A column → `{ "input": key }`, `{ "text": "…" }` (plain text, no braces) or `{ "token": "now" \| "ruleName" \| "recordLabel" }`. |

The validator refuses a step that could not run: a table or column that is not the add-on's, a
column Adminium decides (its key, a `code`, `stamp`, `rollup`, `formula`… rule), an input no
value reads, a column that must hold a value and that nothing fills, and such a column filled
from an input that is not `required`. An input the rule leaves empty is left out of the row, so
the column's own default or rule stands.

What an owner fills an input with is text that may carry `{{record.<column>}}`. A personal column
of the rule's record is read only for an input whose value goes **only** into columns the add-on
marks `personal` itself; such a value is never written to a run's log.

A manifest that gives steps sets `compatibility.minAdminiumVersion` to `0.3.22` or later.
