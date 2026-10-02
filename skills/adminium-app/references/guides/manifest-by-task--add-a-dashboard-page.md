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
- **A board needs a status Adminium can read as a workflow.** `page-board` makes its columns from
  a choice column (`enum`) of two to six values, and at least two of the values must be words
  Adminium knows as steps of a workflow: `todo`, `backlog`, `open`, `new`, `draft`, `in_progress`,
  `doing`, `review`, `blocked`, `on_hold`, `done`, `completed`, `closed`, `cancelled`, `archived`,
  `active`, `paused`, `shipped`. A status of `received`, `baking`, `ready` gives no board. Use
  those words as the values and say your own in `rules.enumLabels`
  (`"in_progress": { "en-US": "Baking" }`), or use `page-crud`.
- **A calendar needs a date.** `page-calendar` plots by the table's `date` or `timestamptz`
  columns, or by the ones `config.calendar` names.
- **A page whose table cannot back its template is created empty.** The check does not see it. The
  install reports it, and `adminium app try` fails on it, naming the page and the reason.
- **A role sees a page only with its grant.** Give each role `page:@<page ref>:view` for the pages
  its people should find in the sidebar ([Add a role](https://docs.adminium.dev/guides/apps/manifest-by-task/#add-a-role)).

Reference: [Pages](https://docs.adminium.dev/reference/manifest/#pages), [navGroups](https://docs.adminium.dev/reference/manifest/#navgroups).
