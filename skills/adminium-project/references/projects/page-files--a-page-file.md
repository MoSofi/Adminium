<!-- produced from apps/docs/src/content/docs/projects/page-files.md § A page file; do not edit -->

# Page files: A page file

```json title="pages/contacts.json"
{
  "$schema": "../node_modules/@adminiumjs/adminium/schemas/page.json",
  "v": 1,
  "kind": "page",
  "template": "page-crud",
  "origin": "generated",
  "title": { "fallback": "Contacts", "key": "nav.contacts" },
  "source": { "database": "main", "table": "main.contacts" },
  "nav": { "group": "people", "icon": "users", "order": 20, "slug": "contacts" },
  "access": { "minRole": "viewer", "permissions": ["table:main.contacts:read"] },
  "config": {
    "columns": [
      { "name": "full_name", "label": "Full Name", "logicalType": "text", "pii": true, "sortable": true },
      { "name": "mrr_amount", "label": "MRR", "format": "currency", "align": "end", "sortable": true }
    ],
    "keyField": "full_name",
    "pageSize": 50
  },
  "generated": { "hash": "9992fe45…" }
}
```

| Field | |
|---|---|
| `template` | Which kind of page it is: `page-crud`, `page-dashboard`, `page-board`, `page-record` and the rest |
| `title` | `fallback` is the text; `key` names a translation when there is one |
| `source.database` | A **key** from `adminium.config.ts`, never a connection id |
| `source.table` | The table, schema-qualified |
| `nav` | Where it sits in the sidebar: `group` (`workspace`, `library`, `planning`, `people` or `account`), `icon`, `order`, and `slug`, which restates the address and must equal the file name |
| `access` | Part of the stored page. The real gate is the role's **View** grant — **See every page** under **People → Roles & permissions**, or one on this page — which lives in Adminium's database, not here |
| `config` | The page itself: columns, filters, the form, dashboard layout — whatever that template takes |
| `generated` | Only on pages Adminium generated ([below](https://docs.adminium.dev/projects/page-files/#edited-by-hand-or-not)) |

Editing one is ordinary work: change a `label`, drop a column, set
`pageSize`, reorder the sidebar with `nav.order`. In
[`npm run dev`](https://docs.adminium.dev/reference/cli/#dev) the page changes as you save.

### No ids, anywhere

A page file names databases by key and pages by address, and holds no id from
any one install — not the page's own, not a connection's, not a destination's.
That is what makes the folder portable: the same files apply to a fresh server
that has never seen your laptop. [`npm run check`](https://docs.adminium.dev/projects/pull-and-check/)
refuses a file that carries one.

### Edited by hand, or not

`generated.hash` is how Adminium knows whether it may regenerate a page. An
untouched generated page carries the hash of its own settings; once you or
Studio change the page, the hash no longer matches, and regenerating the
database leaves that page alone. Do not edit the hash: delete the file if you
want the page generated again from scratch.

Hashes compare meaning, not text. Key order, indentation, `$schema`, a restated
default and the order of schema rows all make no difference, so a file you
wrote by hand still counts as equal to Adminium's own copy.
