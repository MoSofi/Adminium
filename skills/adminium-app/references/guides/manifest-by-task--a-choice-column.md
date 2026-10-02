<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § A choice column; do not edit -->

# A manifest, task by task: A choice column

For a fixed set of values, use `enum`. The values are checked by the database. `rules.enumLabels`
gives each value the words people read, and optionally a badge tone (`neutral`, `accent`, `info`,
`pos`, `warn`, `danger`), as the `status` column of `jobs` does above.

For a list the operator may edit after the install, use a `text` column with `rules.options`, as
`priority` does above, and ship the list in `option-lists.json`:

```json title="manifest/option-lists.json"
{
  "priorities": {
    "label": { "en-US": "Priorities" },
    "values": [{ "value": "Low" }, { "value": "Normal" }, { "value": "Urgent", "tone": "danger" }]
  }
}
```

- An `enum` column must list `enum`, and its `default` must be one of the values.
- `{ "list": "priorities" }` must name a key of `option-lists.json`, or a built-in list such as
  `builtin:countries`. Short inline lists go in `"options": { "values": [{ "value": "…" }] }`.

Reference: [Column rules](https://docs.adminium.dev/reference/manifest/#column-rules), [Option lists](https://docs.adminium.dev/reference/manifest/#option-lists).
