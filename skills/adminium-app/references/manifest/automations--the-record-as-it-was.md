<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — The record as it was; do not edit -->

# Manifest spec: Automations — The record as it was

### The record as it was

A rule run when its record is updated may read the record as it was **before** the change:
`{{was.<column>}}`, in a notice, in a value a step writes, and in the template its e-mail sends.

```json
"trigger": { "kind": "record", "event": "updated", "table": "deals", "changedColumn": "stage" },
"graph": { "version": 1, "nodes": [
  { "id": "t", "kind": "trigger", "title": "A deal moves" },
  { "id": "k", "kind": "action", "title": "Keep where it came from",
    "action": { "kind": "record.update", "values": { "came_from": "{{was.stage}}" } } }
] }
```

It follows the record's own rules: a personal column only in an e-mail, a secret never, and a mail
writes a date or an amount as it writes the record's. A rule run when a row is made or removed, or
by the clock, has no "as it was", and the validator refuses `{{was.*}}` there. Of the row as it
was, the run keeps only the columns its steps and its e-mails' templates read, never a secret one;
they are never shown in Workflow Logs, and are dropped when the run ends, or when it cannot go on.
Needs Adminium 0.3.28.
