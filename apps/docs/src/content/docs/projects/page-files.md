---
title: Page files
description: One JSON file per page and per database, what each field means, and how the folder and a running server stay in step — in dev, on a server, and when both changed.
sidebar:
  order: 3
---

A project keeps its pages and schema customizations as files:

| File | |
|---|---|
| `pages/<address>.json` | One page or dashboard. The file name is its address, `/p/<address>`. |
| `pages/<address>.tsx` | A [page you wrote](/projects/pages-and-widgets/) at the same kind of address. |
| `schema/<database>.json` | One database's labels, hidden columns, masks and relations. |

They are written by Adminium and meant to be read and edited by you. Every file
starts with a `$schema` pointing at a JSON Schema inside the installed package,
so an editor completes the fields and marks a mistake before you save.

## A page file

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
| `generated` | Only on pages Adminium generated ([below](#edited-by-hand-or-not)) |

Editing one is ordinary work: change a `label`, drop a column, set
`pageSize`, reorder the sidebar with `nav.order`. In
[`npm run dev`](/reference/cli/#dev) the page changes as you save.

### No ids, anywhere

A page file names databases by key and pages by address, and holds no id from
any one install — not the page's own, not a connection's, not a destination's.
That is what makes the folder portable: the same files apply to a fresh server
that has never seen your laptop. [`npm run check`](/projects/pull-and-check/)
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

## A schema file

One file per database, holding the customizations that would otherwise only be
in Adminium's tables:

```json title="schema/main.json"
{
  "$schema": "../node_modules/@adminiumjs/adminium/schemas/schema.json",
  "overrides": [
    { "table": "main.contacts", "op": "table.label", "value": { "label": "Customers" } },
    { "table": "main.contacts", "column": "mrr_amount", "op": "column.label", "value": { "label": "MRR" } },
    { "table": "main.contacts", "column": "notes", "op": "column.hidden", "value": { "hidden": true } },
    { "table": "main.audit_rows", "op": "table.exclude", "value": { "excluded": true } }
  ]
}
```

| `op` | `value` |
|---|---|
| `table.label` | `label`, and optionally `labelPlural` and `icon` |
| `table.exclude` | `excluded` |
| `table.keyField` | `column` |
| `column.label` | `label` |
| `column.semanticType` | `semanticType`, and `currency` for money |
| `column.enumLabels` | `labels` per value, and optionally `tones` |
| `column.pii` | `masked`, and optionally `kind` |
| `column.hidden` | `hidden` |
| `relation.add` | `fromColumn`, `toTable`, `toColumn`, `cardinality` |
| `relation.remove` | `fromColumn`, `toTable` |
| `relation.label` | `fromColumn`, `label` |

A row the [LLM assist](/guides/llm-assist/) proposed and you accepted carries
`"origin": "llm"` and its `confidence`. The masks Adminium proposes by itself
are **not** written: every install classifies its own schema and derives them
again, so they would be noise in a diff. Your own corrections, including one
that turns a proposed mask off, are written.

`"status": "disabled"` keeps a row in the file while turning it off — the same
thing as switching it off in Studio.

## In `npm run dev`, the folder wins

While `dev` runs, the folder is the master copy and Studio writes back into it:

| | |
|---|---|
| You save a page or schema file | It is applied at once, and open pages reload. Adminium prints `Applied pages/contacts.json.` |
| You delete a file | Its page is removed |
| You edit a page in Studio | The change is saved and written to its file, touching only the lines that changed |
| You create a page in Studio | A new file is written for it |
| A command such as `apply-llm-response` changed something | It is written to its file, including changes made while `dev` was not running |
| Both the file and the database changed | The file wins, and `dev` says so |
| A file has a mistake | It is not applied, the last good version stays in use, and the reason names the file and the field |

The last one, in full:

```
pages/contacts.json was not applied:
  source.database: "billing" is not a database in adminium.config.ts, or it has no connection yet
```

```
pages/contacts.json was not applied:
  not valid JSON: Expected ',' or '}' after property value (line 4, column 3)
```

## On a server, the deploy wins

A server does not write your folder. It applies the files it was deployed with
and, when someone edits a page in Studio there, keeps that edit and marks it:

| | |
|---|---|
| A file changed since the last start | Applied at start |
| …but its page was also edited on this server | The server's copy is kept, and the page is a **conflict** |
| A page edited on this server | Kept, and marked **changed on server** until you [pull](/projects/pull-and-check/) it |
| A page created on this server | Kept, and marked **not in project** |
| A file deleted in the deploy | Its page is removed, unless it was edited here — then it is kept and marked |
| A file with a mistake | Not applied; the boot log says why, and the last good copy stays in use |

Nothing is lost either way, and nothing is overwritten silently. Studio → Pages
shows a banner naming what happened:

> **3 pages were changed on this server** — Pull the changes into your project
> and deploy it, or they stay on this server only:
> `npm run pull -- --from https://this-server`

A page changed on both sides offers two buttons: **Keep server copy** leaves it
flagged until you pull it, and **Use project copy** applies the file's version
now.

**Studio → Settings → Project** (super admins) shows the whole picture for the
project the server runs: which folder, whether it runs as `dev` or as a server,
how many page and schema files, what changed here, and the hooks, actions, pages
and widgets it loaded — with any that failed to load, and any hook that has
errored since the server started.

## Pages that have no file

- Pages that installed **apps and add-ons** bring, and Adminium's own system
  pages.
- Pages of a database `adminium.config.ts` does not list. Studio says so:
  add the database to the config to keep its pages in the project.
- A second page that wants an address another one already has. The database
  whose key sorts first alphabetically gets the file.

They keep working. They are simply not yours to commit.
