<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Buttons on a record page; do not edit -->

# A manifest, task by task: Buttons on a record page

A table with [states](https://docs.adminium.dev/reference/manifest/#states) may put its own buttons on the generated
record page, in the app's words, with `states.actions`:

```json title="manifest/tables/jobs.json"
"states": {
  "column": "status", "initial": "open",
  "moves": { "open": ["done"] },
  "actions": [
    { "id": "finish", "label": "Mark done", "move": { "to": "done" }, "tone": "primary",
      "confirm": "Mark this job done?", "set": { "done_at": { "now": true } } },
    { "id": "note", "label": "Add a note", "in": ["open", "done"],
      "child": { "table": "job_notes", "via": "job_id", "form": ["text"] } }
  ]
}
```

A button moves the row, writes columns, opens another page with the row, or adds a child row from
a small form. It is shown in the states it names, to a person whose role may make the change; one
the server would refuse says why. A list page takes up to two actions on the ticked rows the same
way (`config.bulk`). Both need `"minAdminiumVersion": "0.3.18"`. See
[Buttons on a record](https://docs.adminium.dev/reference/manifest/#buttons-on-a-record) and
[Tab words, filters and bulk actions](https://docs.adminium.dev/reference/manifest/#tab-words-filters-and-bulk-actions).

Checked most often: a move no listed move reaches; a column set that is the state column or one
Adminium fills; a locked table whose `lock.except` does not list a column the button writes.
