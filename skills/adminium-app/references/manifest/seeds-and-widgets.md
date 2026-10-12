<!-- produced from apps/docs/src/content/docs/reference/manifest.md § seeds and widgets; do not edit -->

# Manifest spec: seeds and widgets

`seeds` are the rows an app's tables hold from the first second: the one row of its settings, its
list of reasons, its units. They are not demo rows; use [`sampleData`](https://docs.adminium.dev/reference/manifest/#sample-data) for those.

```json
"seeds": [
  { "table": "settings", "rows": [{}] },
  { "table": "reasons", "rows": [
    { "@label": "late", "label": { "@t": { "en-US": "Late", "de-DE": "Verspätet" } } },
    { "label": "Damaged" }
  ] },
  { "table": "checks", "rows": [{ "name": "Call back", "reason_id": { "@ref": "late" } }] }
]
```

Each entry names one of the app's own tables and gives its rows inline (`rows`) or in a file of
the package (`"file": "seeds/reasons.json"`, a JSON list of rows), exactly one of the two. A table
is seeded with at most 200 rows.

- **When they are written.** Once, by the install, after the tables and their rules exist: a row
  gets its table's defaults, copies, formulas, numbers and codes like any new row, so `{}` is a row
  of defaults. All of an install's seeds go in one statement group: a refused row leaves none
  behind and the install stops at its `seeds` step (`APP_INSTALL_INCOMPLETE`); installing again
  takes it up from there.
- **Only into an empty table.** A table that already holds a row (tables kept from an earlier
  install, a table the owner filled) is left exactly as it is, and a row that points at a row left
  out that way is left out with it.
- **An update** writes the seeds of the tables that version brings and of no other: a table the
  version before already had is the owner's by now, empty or not.
- **They are the owner's rows afterwards.** "Remove sample data" never takes one, and the app's
  roles decide who may change them.
- **A value** is a plain value, `{ "@t": { "en-US": "…", "de-DE": "…" } }` (written in the
  installing person's language) or `{ "@ref": "<label>" }` (the key of an earlier seed row that
  carries `"@label"`). No other directive is read.
- **Not allowed:** a table built on an add-on's shape (the add-on numbers its own rows), a
  [private](https://docs.adminium.dev/reference/manifest/#whose-a-row-is) table, and a value in a column that holds a staff member (a manifest
  does not know who works here; leave the column out).

An app's `seeds` are read from Adminium 0.3.27 on, so a manifest that has them sets
`compatibility.minAdminiumVersion` to `0.3.27` or later; earlier releases accepted the block and
wrote nothing. An add-on's `seeds` are described under [Add-on manifests](https://docs.adminium.dev/reference/manifest/#add-on-manifests).

`widgets` (a list of `{ "id", "entry" }`) are accepted by the schema, but this release does not act
on them.
