<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Sample data; do not edit -->

# A manifest, task by task: Sample data

Two files: `sample.json` names the data file, and the data file sits in the app's `seeds/` folder,
outside `manifest/`.

```json title="manifest/sample.json"
{ "sampleData": { "file": "seeds/sample.json" } }
```

```json title="seeds/sample.json"
{
  "format": "adminium.sample/1",
  "app": "repairs",
  "tables": [
    { "ref": "customers", "rows": [
      { "@label": "ada", "name": "Ada Byrne", "email": "ada@example.com" }
    ] },
    { "ref": "jobs", "rows": [
      { "title": "Replace the hinge", "customer_id": { "@ref": "ada" }, "status": "waiting",
        "due_on": { "@day": 2 }, "created_at": { "@ago": "PT3H" } }
    ] }
  ]
}
```

- `@label` names a row; `{ "@ref": "<label>" }` in a later row is that row's key. The labelled row
  must come first, so list parent tables before the tables that link to them.
- `{ "@ago": "PT3H" }` is a moment that long before the data is added, as an ISO 8601 duration.
- `{ "@day": 2 }` is a date that many days from today; with `"@time": "09:30"`, a time on it.
- `app` must be the app's key, and every table and column must be one the manifest declares.
- Leave out the columns Adminium fills (`number` here). Never write a key by hand.

Reference: [Sample data](https://docs.adminium.dev/reference/manifest/#sample-data), [Sample data](https://docs.adminium.dev/guides/apps/sample-data/).
