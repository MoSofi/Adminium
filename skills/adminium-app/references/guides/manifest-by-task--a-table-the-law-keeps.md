<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § A table the law keeps; do not edit -->

# A manifest, task by task: A table the law keeps

Rows the law makes the business keep (invoices, a patient's records) say so in their table file:

```json title="manifest/tables/invoices.json (part)"
"keep": { "law": "tax" }
```

`law` is `tax`, `health`, `contract` or `safety`. An erasure leaves these rows as they are and
lists them, with the reason, under "What stays". Needs `0.3.37`.

Reference: [Kept by law](https://docs.adminium.dev/reference/manifest/#kept-by-law).
