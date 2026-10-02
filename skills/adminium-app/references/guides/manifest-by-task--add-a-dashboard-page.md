<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Add a dashboard page; do not edit -->

# A manifest, task by task: Add a dashboard page

One file per page, in `manifest/pages/`. A page is a `template` over one of the app's tables.

```json title="manifest/pages/repairs-jobs.json"
{
  "ref": "repairs-jobs",
  "template": "page-crud",
  "title": { "key": "repairs.jobs", "fallback": "Jobs" },
  "nav": { "group": "main", "icon": "wrench", "order": 1 },
  "bindings": { "rows": "jobs" }
}
```

Ten templates read one table, named by `"bindings": { "rows": "<table ref>" }`: `page-crud` (a
list with a form), `page-board` (cards in columns, by a status), `page-calendar` (rows by a date),
`page-scheduler` (a timeline), `page-directory` (people or places as cards), `page-master-detail`
(a list beside the open record), `page-queue-inbox` (a queue to work through), `page-log-viewer`
(a log), `page-files` and `page-chat`. `page-dashboard` reads several tables: it takes no
`bindings`, and its cards are in `config.layout`.

- **The ref is shared.** A page's `ref` is its address, `/p/<ref>`, and every app on the same
  database shares those addresses. Start it with the app key: `repairs-jobs`, not `jobs`.
- **`nav.group`** names a `key` of `navGroups` in `app.json`. A group that is not declared there
  is not refused: the page is listed first, with no heading.
- **`bindings`** names a table ref. A template or a table the manifest does not have is not
  refused by the check either: the page is created empty and the install report says why. So
  check the spelling of both.
- `title` is `{ "key", "fallback" }`, not a plain string. `icon` is a
  [Lucide](https://lucide.dev/icons/) name.
- **A board or a calendar needs no settings.** `page-board` makes its columns from the table's
  status: a column with `enum` values, or its `states`. `page-calendar` plots by the table's date
  columns, or by the ones `config.calendar` names. A table that cannot back its template (a board
  over a table with no choice column) gives a page that is created empty; the install reports it,
  and `adminium app try` fails on it, naming the page.
- **A role sees a page only with its grant.** Give each role `page:@<page ref>:view` for the pages
  its people should find in the sidebar ([Add a role](https://docs.adminium.dev/guides/apps/manifest-by-task/#add-a-role)).

Reference: [Pages](https://docs.adminium.dev/reference/manifest/#pages), [navGroups](https://docs.adminium.dev/reference/manifest/#navgroups).
