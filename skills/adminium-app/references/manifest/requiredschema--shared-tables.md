<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Shared tables; do not edit -->

# Manifest spec: requiredSchema — Shared tables

### Shared tables

Two apps may use one table between them: a restaurant's point of sale and its online ordering
read and write the same menu. Each app declares the table with the same `shape`, a name and a
version (`"shape": "menu@1"`); the second app's install plan finds the first app's table and
offers to share it (the **Shared** case in [What the plan does with each
table](https://docs.adminium.dev/reference/manifest/#what-the-plan-does-with-each-table)), with the same safe changes it would make to a table
it reuses.

```json
{ "ref": "menu_items", "shape": "menu@1", "columns": [ … ] }
```

While a table is shared:

- Rules both apps keep on it (labels, choices, column rules) are kept once: the install skips a
  rule the other app already keeps there, naming it.
- Uninstalling either app names the other on the uninstall preview, keeps the table, and hands the
  rules it kept there to the other app. Those rules survive the other app's updates, unless a
  version of it declares its own value for the same column.
- An app reinstalled beside a menu it used to share is offered it again. A table another app still
  uses is never offered for renaming out of the way.
- An app update that stops declaring a table's `shape` stops sharing it, but only while no other
  app shares the table; while one does, the update is refused `409` `SHAPE_IN_USE`, naming it.

A shared table's real rows are the venue's: the second app's [sample data](https://docs.adminium.dev/reference/manifest/#sample-data) can leave
its demo rows for it out (`skipWhenShared`). A table has `shape` or [`builtOn`](https://docs.adminium.dev/reference/manifest/#tables-built-on-an-add-ons-shape),
never both. See [A menu two apps share](https://docs.adminium.dev/guides/apps/shared-menu/).
