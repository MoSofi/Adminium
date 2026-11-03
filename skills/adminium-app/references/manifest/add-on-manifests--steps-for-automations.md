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
| `inputs` | Up to 8. `kind` is `text`, `email`, `number`, `choice` (with `options`), `record` (with `table`: a row of one of the add-on's tables is picked, and its key is the value) or `person` (whose row of a people table the step is about; see below). `required` makes the rule unfinished until it is filled. `help` is a line under the field, in every language (160 characters). |
| `options[].help` | A line under one choice, in every language (160 characters): the rule editor then draws the choice as cards. |
| `record` inputs: `by`, `where` | `by` names the row by a unique column of its table in place of its key (a survey by its `slug`): the rule keeps that value, and the run finds the row by it and writes its key. `where` (1–3 `{ "column", "eq" }`) holds the rows that may be picked to those values, in the editor's list and at the run: a name that finds none fails the step by name. |
| `writes.table` | One of the add-on's own tables. |
| `writes.values` | A column → `{ "input": key }`, `{ "text": "…" }` (plain text, no braces), `{ "token": "now" \| "ruleName" \| "recordLabel" \| "recordTable" \| "recordKey" }` or `{ "person": key, "field": "email" \| "name" \| "language" \| "company" \| "table" \| "key" }`. |

The validator refuses a step that could not run: a table or column that is not the add-on's, a
column Adminium decides (its key, a `code`, `stamp`, `rollup`, `formula`… rule), an input no
value reads, a column that must hold a value and that nothing fills, and such a column filled
from an input that is not `required`. An input the rule leaves empty is left out of the row, so
the column's own default or rule stands.

What an owner fills an input with is text that may carry `{{record.<column>}}`. A personal column
of the rule's record is read only for an input whose value goes **only** into columns the add-on
marks `personal` itself; such a value is never written to a run's log.

A manifest that gives steps sets `compatibility.minAdminiumVersion` to `0.3.22` or later.

**A step about a person** (a survey's invitation, for one). A `person` input is filled in the rule
with `@record` (the rule's record itself, on a table an app declares in `people`) or
`@link:<column>` (the person one link column of the record names: "the job's main contact"; a
column that copies a link through another counts as that link). One hop, never two; the save
refuses any other table. Its fields fill the step's columns: `email`, `name`, `language` (the
install's own language where the person's table keeps none), `company` (the label of the
company the people declaration links them to), and `table` and `key` (their row as the consent
log names it, so a "no" given by the person's row is heard). The address and the name are
personal: they go only into columns the add-on marks `personal`, and are never written to a
run's log (a test run says "found (kept private)"). A record that names nobody, or somebody with
no address, fails the step by name and writes nothing.

`recordTable` and `recordKey` are the rule's record as other rows name it: its table's stored
name (`<app>:<table>`, what a [record tab](https://docs.adminium.dev/reference/manifest/#a-tab-on-another-tables-record)'s `match.table` holds; a column holding
it carries `rules.tableRef`) and its key as text. A table on which a rule runs one of the
add-on's steps counts as `linked` for the add-on's record tabs.

A step's row whose key is a text column nothing else fills is given a fresh id.

`person`, `by`, `where`, `help` and the two record tokens need Adminium `0.3.41`.
