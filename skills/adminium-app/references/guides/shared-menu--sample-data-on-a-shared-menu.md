<!-- produced from apps/docs/src/content/docs/guides/apps/shared-menu.md § Sample data on a shared menu; do not edit -->

# A menu two apps share: Sample data on a shared menu

Each app may ship sample dishes. A venue's real menu should never gain them, nor sample orders of
them. `sampleData.skipWhenShared` keeps an app's sample rows off a shared table that already holds
real rows:

```json
"sampleData": {
  "file": "seeds/ordering.sample.json",
  "skipWhenShared": {
    "table": "menu_items",
    "skip": ["menu_categories", "menu_items", "modifier_groups", "modifiers", "orders", "order_items"]
  }
}
```

When sample data is added, Adminium looks at `table`. If another installed app uses it too and it
holds at least one real row (a row no installed app's sample data added), the sample rows of every
table in `skip` are left out: the dialog does not list them, and nothing is written there. A
shared menu that holds only sample rows, or a menu the app keeps alone, takes the whole sample.

| Field | Rule |
|---|---|
| `table` | One of the app's tables, declared with a `shape`. |
| `skip` | 1 to 50 of the app's own tables, each once. Every table left in whose rows link to a skipped one must be skipped too, or its sample rows would point at rows never added. |

The check says which table is missing:

```text
"order_items" links to "menu_items" (menu_item_id), which is skipped: skip "order_items" too, or its sample rows point at rows never added
```

Removing sample data keeps any sample row a real row uses, and on a shared menu that includes the
other app's real rows: a sample dish the shop's real order points at stays, with its category. See
[Sample data](https://docs.adminium.dev/guides/apps/sample-data/).
