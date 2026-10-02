---
title: A manifest, task by task
description: What to write, and in which file, to add a table, link two tables, add a page, a role, public access, sample data, settings and add-ons to an app of your own.
---

This page is for someone building an app in a project's `apps/<key>/` folder
([An app in your project](/projects/apps/)). Each section is one task: the part file it goes in, a
small example, and the mistakes the check most often refuses. The
[manifest spec](/reference/manifest/) has every field; each section links to its part of it.

The examples are one app, `repairs`. After every change, run:

```bash
npx @adminiumjs/adminium app check
```

`app.json` is the app itself. The other sections add files beside it.

```json title="manifest/app.json"
{
  "manifestVersion": 1,
  "key": "repairs", "name": "Repairs", "version": "0.1.0",
  "publisher": { "id": "local", "name": "Local" },
  "license": "UNLICENSED", "categories": ["operations"],
  "description": { "key": "repairs.description", "fallback": "Repairs, made with Adminium." },
  "compatibility": { "minAdminiumVersion": "0.3.12" },
  "frontends": [{ "side": "customer", "kind": "spa" }],
  "navGroups": [{ "key": "main", "label": { "en-US": "Repairs" }, "order": 1 }],
  "prefixed": true
}
```

`publisher` is `local` for an app made in your own project, `key` is the folder's name, and
`categories` is one or more of `commerce`, `hospitality`, `operations`, `crm`, `internal-tools`.

Two rules hold everywhere. Every object is strict: a field the spec does not list is an error. And
a table or page file is named after its `ref`: `tables/jobs.json` holds `"ref": "jobs"`.

## Add a table

One file per table, in `manifest/tables/`.

```json title="manifest/tables/customers.json"
{
  "ref": "customers",
  "label": { "en-US": "Customer" }, "labelPlural": { "en-US": "Customers" }, "keyField": "name",
  "columns": [
    { "ref": "id", "type": "int", "role": "pk" },
    { "ref": "name", "type": "text", "maxLength": 120, "default": "", "label": { "en-US": "Name" } },
    { "ref": "email", "type": "text", "maxLength": 200, "nullable": true },
    { "ref": "vip", "type": "bool", "default": false },
    { "ref": "created_at", "type": "timestamptz", "role": "created_at", "default": "now" }
  ]
}
```

- **Types.** `type` is one of `id`, `text`, `int`, `bigint`, `decimal`, `money`, `float`, `bool`,
  `enum`, `json`, `date`, `timestamptz`, `uuid`, `fk`, `blob`.
- **The key.** One column has `"role": "pk"`. An `int` key numbers itself and takes no `default`.
- **Empty or filled.** A column is `NOT NULL` unless it says `"nullable": true`. A column with
  neither `nullable` nor a `default` makes the check warn that it "has no default and is not
  nullable": every new row must then give it a value, and a form that does not show the column
  cannot save. Give it one of the two, unless a [rule](#values-adminium-fills-in) fills it.
  When you mean the column to be required (a customer's name, a job's bike), leave it as it is:
  the warning is advice and the check still passes.
- **Money.** A price is `{ "ref": "price", "type": "money", "nullable": true }`. It is kept in the
  database's currency with that currency's decimals; a screen formats it with the venue's
  `currency`, never a symbol written into the code.
- **Defaults.** A `text` default needs `maxLength`. A `timestamptz` default is `"now"` and nothing
  else. An `enum` default is one of its values. `date`, `json`, `blob`, `id`, `uuid` and `fk` take
  none.
- **`maxLength`** is for `text` only, from 1 to 1000. Without it the column is unbounded text,
  which can take neither a default nor `"unique": true`.
- **Names for people.** `label` is one row ("Customer"), `labelPlural` the table, and it needs
  `label`. `keyField` is the column that names a row where another table links to it; it must be
  one of the table's columns.

`"prefixed": true` in `app.json` names every table `<key>_<ref>` in the database
(`repairs_customers`), so two apps never collide. The manifest always uses the short ref.

Reference: [Tables](/reference/manifest/#tables), [Columns](/reference/manifest/#columns),
[Defaults](/reference/manifest/#defaults), [Table names and `prefixed`](/reference/manifest/#table-names-and-prefixed).

## Link two tables

A link is an `fk` column whose `references` is the other table's `ref`.

```json title="manifest/tables/jobs.json"
{
  "ref": "jobs",
  "label": { "en-US": "Job" }, "labelPlural": { "en-US": "Jobs" }, "keyField": "title",
  "columns": [
    { "ref": "id", "type": "int", "role": "pk" },
    { "ref": "number", "type": "int", "rules": { "sequence": { "start": 1000 } } },
    { "ref": "title", "type": "text", "maxLength": 120, "default": "Untitled" },
    { "ref": "customer_id", "type": "fk", "references": "customers", "nullable": true },
    { "ref": "status", "type": "enum", "enum": ["open", "waiting", "done"], "default": "open",
      "rules": { "enumLabels": { "labels": { "open": "Open", "waiting": "Waiting for parts", "done": "Done" },
                                 "tones": { "done": "pos" } } } },
    { "ref": "priority", "type": "text", "maxLength": 40, "nullable": true,
      "rules": { "options": { "list": "priorities" } } },
    { "ref": "due_on", "type": "date", "nullable": true },
    { "ref": "done_at", "type": "timestamptz", "nullable": true,
      "rules": { "stamp": { "set": "now", "on": { "column": "status", "values": ["done"] } } } },
    { "ref": "created_at", "type": "timestamptz", "role": "created_at", "default": "now" }
  ]
}
```

- `references` is a table **ref** (`customers`), never the real name (`repairs_customers`) and
  never a column. A ref the manifest lacks passes the check and is refused at install, unless a
  table of that name already exists, so check the spelling.
- The target must have exactly one `pk` column; the link takes its type.
- An `fk` takes no `default`. Make it `nullable` unless every row must have one.
- Forms and lists show the linked row by its table's `keyField`, so give the target one.

Reference: [Columns](/reference/manifest/#columns).

## A choice column

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

Reference: [Column rules](/reference/manifest/#column-rules), [Option lists](/reference/manifest/#option-lists).

## Add a dashboard page

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
  its people should find in the sidebar ([Add a role](#add-a-role)).

Reference: [Pages](/reference/manifest/#pages), [navGroups](/reference/manifest/#navgroups).

## Add a role

`roles.json` is the array of roles the app brings. Each is installed as `<app key>-<role key>`
(`repairs-staff`).

```json title="manifest/roles.json"
[
  { "key": "staff", "name": "Repairs staff", "permissions": [
      "table:@customers:read", "table:@customers:create", "table:@customers:update",
      "table:@jobs:read", "table:@jobs:create", "table:@jobs:update",
      "table:@requests:read", "table:@requests:update", "page:@repairs-jobs:view" ] },
  { "key": "manager", "name": "Repairs manager", "cloneFrom": "staff", "permissions": ["table:@jobs:delete"] }
]
```

The `@` stands for "this app's": a manifest cannot know the real table names or page ids, so it
writes the short ref after `@` and the install fills in the rest.

| Grant | Actions |
|---|---|
| `table:@<table ref>:<action>` | `read`, `create`, `update`, `delete`, `export`, `import`, `read_pii` |
| `page:@<page ref>:<action>` | `view`, `edit` |
| `app:@:staff` | Open the app's staff screens. |

- **Pages are granted one by one.** A role without `page:@<page ref>:view` does not see that page
  in the sidebar, whatever it may do with the table.
- **Personal data is masked without `read_pii`.** A column that holds a person's name, phone,
  email or address reads as empty to a role that lacks `table:@<table ref>:read_pii` on the table
  the value lives in. A front desk that rings customers needs it. See
  [Personal data](/guides/apps/roles-and-staff-access/#personal-data).
- A role may never grant a `system:` permission, a wildcard (`*`), or a table or page the app
  does not declare. `cloneFrom` names another role of the same app.
- These are refused when the app is installed, not by the manifest check, so run
  `npx @adminiumjs/adminium app try` after changing roles.
- `<app key>-<role key>` must fit in 40 characters.

Reference: [Roles](/reference/manifest/#roles),
[App roles and staff access](/guides/apps/roles-and-staff-access/).

## Let customers read or add

`access.json` holds `publicAccess`: the only things the customer side can reach. A table with no
entry here is out of its reach, whatever the screens try. The app needs a customer side for it:
`{ "side": "customer", "kind": "spa" }` in `frontends`, and its code in `customer/`.

```json title="manifest/access.json"
{
  "publicAccess": [
    { "table": "jobs", "methods": ["GET"], "select": ["number", "status"] },
    { "table": "requests", "methods": ["POST"], "select": ["id"],
      "writable": ["message"], "defaults": { "handled": false } }
  ]
}
```

`requests` is a table made for what customers send in:

```json title="manifest/tables/requests.json"
{
  "ref": "requests",
  "columns": [
    { "ref": "id", "type": "int", "role": "pk" },
    { "ref": "message", "type": "text", "maxLength": 500, "default": "" },
    { "ref": "handled", "type": "bool", "default": false },
    { "ref": "created_at", "type": "timestamptz", "role": "created_at", "default": "now" }
  ]
}
```

| Field | What it says |
|---|---|
| `table` | One of the app's table refs. |
| `methods` | `GET` to read, `POST` to add, `PATCH` to change. |
| `select` | The columns a reply carries. Leave it out and every column is sent, so list them. |
| `writable` | The columns a browser may set. |
| `defaults` | Values the server writes whatever the browser sends. |

- **Add or read, not both.** A table anyone may add a row to may not also be one anyone may read:
  every row could be read by guessing ids. Put `GET` and `POST` on different tables, as here.
- `PATCH` is refused without a `claim`, a `claimedBy` or a `visibleWith`: nobody changes a row
  without proving it is theirs.
- `writable` never names a column Adminium fills (a `sequence`, a `code`, a `stamp`, a total).

**A person's own rows.** An entry with `claim` lets a person prove who they are, by details of
their row or by a link emailed to them, and so opens a session. An entry with
`claimedBy: { "table", "column" }` then reaches only that person's rows: their own jobs, not
everyone's. Read [Guests, their details and their own links](/guides/apps/identity-and-own-links/)
before writing either.

Reference: [Public access](/reference/manifest/#public-access),
[A person's own rows](/reference/manifest/#a-persons-own-rows).

## Sample data

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

Reference: [Sample data](/reference/manifest/#sample-data), [Sample data](/guides/apps/sample-data/).

## Settings the operator fills in

`settings.json` is the array of values the operator sets on the app's settings page. The app's
screens read them, with their defaults.

```json title="manifest/settings.json"
[
  { "key": "shop_name", "type": "string", "default": "My workshop",
    "label": { "key": "repairs.setting.shopName", "fallback": "Shop name" } },
  { "key": "days_to_repair", "type": "number", "default": 3, "min": 1, "max": 30, "unit": "days" },
  { "key": "open_saturdays", "type": "boolean", "default": false }
]
```

- `type` is `string`, `number`, `boolean`, `enum` (with its `enum` values), `file` or `json`.
  `key` is snake_case.
- A setting's `label` is `{ "key", "fallback" }`, unlike a column's.
- Every setting that is not `"secret": true` is sent to the customer side. Do not put bank details
  or keys here.

Reference: [Settings](/reference/manifest/#settings).

## Emails

`emails.json` holds `outbox` and `emailTemplates`. The app declares a table of its own as the
outbox, says what queues a row in it (a job created, a status changed to `done`), and ships the
templates those rows are sent with. Adminium sends them through the operator's own mail settings;
the app never talks to a mail server. The outbox table has columns Adminium writes itself, so
follow [An app's emails](/guides/apps/emails/) step by step rather than writing it from memory.

Reference: [Emails](/reference/manifest/#emails).

## Build on an add-on

`add-ons.json` names the add-ons the app needs. Use one that exists rather than building the same
thing again: invoices and holiday calendars are add-ons.

```json title="manifest/add-ons.json"
{
  "suggests": [
    { "key": "holiday-calendars", "range": ">=1.0.6", "checked": true,
      "reason": { "en-US": "Marks public holidays on the calendar." } }
  ],
  "features": [
    { "id": "holidays", "label": { "en-US": "Public holidays" }, "requires": ["holiday-calendars"] }
  ]
}
```

- `requires` (same shape, without `checked`) is installed with the app, and the install is refused
  when it cannot be had. `suggests` is offered, ticked when `checked`.
- A `features` entry may only require an add-on the app requires or suggests. A page with
  `"feature": "holidays"` stays hidden until that add-on is there.
- `reason` and `label` are keyed by language and must include `en-US`. `range` is a semver range.

Reference: [Add-ons](/reference/manifest/#add-ons), [Build on an add-on](/guides/building-on-an-add-on/).

## Values Adminium fills in

A column's `rules` ask Adminium to keep something true of it. In `jobs` above, `number` is the
next number in a series and `done_at` is written when the status becomes `done`.

| Rule | What it does |
|---|---|
| `options` | The allowed values, from an option list or written inline. |
| `enumLabels` | Words and badge tones for an enum's values. |
| `required` | A value is required on every write. |
| `requiredWhen` | Required only while another column holds one of some values. |
| `validation` | A format (`email`, `url`, `phone`), a `min`/`max`, a `minLength`/`maxLength`. |
| `normalize` | How text is kept: `trim`, `email` (trimmed, lower case) or `code`. |
| `copy` | Takes a value from the linked row (`via` a foreign key, `from` its column). |
| `default` | Fills an empty column on create from the connection's currency or a setting. |
| `sequence` | The next number in a running series; `gapless` for one with no gaps. |
| `format` | Text written from a gapless number: a prefix and padded digits (`INV-0042`). |
| `code` | A short random code, unique in the column. |
| `formula` | A number worked out from the row's other columns. |
| `rollup` | A total or a count over child rows, kept up to date. |
| `stamp` | A value written when something happens: the moment, who did it, a deadline. |
| `lookup` | A foreign key filled from a code a person types into another column. |
| `perNight` | A price worked out night by night. |
| `notAfter`, `notBefore` | A date kept on one side of today, or of another date. |
| `venueLocal` | A time given with no zone is read in the venue's time zone. |
| `personal`, `secret` | Whether the column is personal data, or a secret no reply carries. |
| `retryKey` | The column a staff create keeps its retry key in. |

- One rule decides a column's value. `copy`, `default`, `sequence`, `format`, `code`, `formula`,
  `rollup`, `stamp`, `lookup` and `perNight` cannot be combined, except a `copy` with a `default`
  behind it.
- A column Adminium fills cannot be `writable` in `access.json`, and a primary key takes neither
  `sequence` nor `code`.
- Every name a rule uses must be a column or table of the manifest, of the right type.

Reference: [Column rules](/reference/manifest/#column-rules).

## Things a manifest cannot do

- **No server code.** An app package is a manifest, sample data and browser screens. Nothing in it
  runs on the server. A project's hooks and actions stay in the project and are not packed.
- **No payments.** Nothing in a manifest charges a card. `payments` in `capabilities` is a label
  on the app's card and does nothing else. Record a payment as a row staff enter.
- **Not an empty app.** A manifest needs at least one table, one page and one `frontends` entry.
  An app with no screens of its own still declares one, of kind `none`:

```json
"frontends": [{ "side": "staff", "kind": "none" }]
```

Reference: [Frontends](/reference/manifest/#frontends), [Validation](/reference/manifest/#validation).
