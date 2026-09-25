---
title: Manifest spec
description: The manifest.json every app and add-on package carries — identity, tables, bookings, pages, frontends, roles, settings, emails, public access and sample data, field by field.
---

A **manifest** is the `manifest.json` at the root of an app or add-on package. It tells Adminium
what the package is, which tables it needs in the operator's database, and what it adds on top of
them: pages in the sidebar, roles, settings, frontends, emails, public endpoints and sample data. Adminium
validates it before anything is installed, and builds the install plan from it.

This page describes version 1 of the format, which is what Adminium 0.3 reads. For what an operator
sees when they install a package, see [Installing apps](/self-hosting/installing-apps/) and
[Installing add-ons](/self-hosting/installing-add-ons/).

There are two kinds of manifest:

- An **app** (`"kind": "app"`) is a whole product: its own tables, its own pages and its own
  staff and customer screens, served at `/apps/<key>/<side>/`. Most of this page is about apps.
- An **add-on** (`"kind": "add-on"`) extends an app or the dashboard with code that runs inside
  Adminium. It shares the identity and table blocks and adds an `addOn` block. See
  [Add-on manifests](#add-on-manifests).

## A small app manifest

```json
{
  "manifestVersion": 1,
  "kind": "app",
  "key": "visits",
  "name": "Visits",
  "version": "1.0.0",
  "publisher": { "id": "adminium", "name": "Adminium" },
  "license": "AGPL-3.0-only",
  "description": { "key": "mft.visits.desc", "fallback": "Book and track client visits." },
  "categories": ["operations"],
  "compatibility": { "minAdminiumVersion": "0.3.0" },
  "requiredSchema": {
    "prefixed": true,
    "tables": [
      {
        "ref": "visits",
        "label": { "en-US": "Visit", "de-DE": "Besuch" },
        "labelPlural": { "en-US": "Visits", "de-DE": "Besuche" },
        "keyField": "client",
        "columns": [
          { "ref": "id", "type": "int", "role": "pk" },
          { "ref": "client", "type": "text", "maxLength": 80 },
          { "ref": "starts_at", "type": "timestamptz" },
          { "ref": "status", "type": "enum", "enum": ["booked", "done", "cancelled"], "default": "booked" }
        ]
      }
    ]
  },
  "pages": [
    {
      "ref": "visits-calendar",
      "template": "page-calendar",
      "title": { "key": "mft.visits.page.calendar", "fallback": "Calendar" },
      "nav": { "group": "records", "icon": "calendar-days", "order": 1 },
      "bindings": { "rows": "visits" }
    }
  ],
  "frontends": [{ "side": "staff", "kind": "spa", "entry": "index.html" }]
}
```

## Conventions

Several shapes recur throughout the format.

| Shape | Rule |
|---|---|
| **i18n message** | `{ "key": "...", "fallback": "..." }`. `key` is a catalogue key (1–120 characters); `fallback` is the English text shown when the key is not in the catalogue (1–400 characters). Both are required and nothing else is allowed. |
| **Label** | Either a plain string (1–256 characters), or an object keyed by BCP 47 tag, such as `{ "en-US": "Category", "de-DE": "Kategorie" }`. A keyed label must include `en-US`, which every reader falls back to. Each value is 1–120 characters. |
| **snake_case ref** | `^[a-z][a-z0-9_]*$`. Used for table refs, column refs and setting keys. |
| **kebab-case key** | `^[a-z][a-z0-9-]*$`. Used for page refs, role keys, nav group keys and option list names. |
| **Version** | Strict semver: `major.minor.patch`, with an optional pre-release and build part (`1.2.0`, `0.3.0-rc.4`). |

Every object in a manifest is **strict**: a field this page does not list is an error, not
something Adminium ignores. See [Validation](#validation).

## Identity

| Field | Required | Rule |
|---|---|---|
| `manifestVersion` | yes | Always `1`. |
| `kind` | no | `"app"` or `"add-on"`. A manifest with no `kind` is read as an app. |
| `key` | yes | `^[a-z][a-z0-9-]{1,79}$`, so 2–80 characters. Apps and add-ons share one key namespace. `apps`, `add-on`, `add-ons`, `dashboard`, `demo`, `index` and `search` are reserved. |
| `name` | yes | Display name, 1–80 characters. |
| `version` | yes | Strict semver. |
| `publisher` | yes | `{ id, name, url? }`. `id` matches `^[a-z][a-z0-9-]{1,39}$`, `name` is 1–80 characters, `url` is an optional URL of up to 200 characters. |
| `license` | yes | An SPDX identifier for the package's own code, 1–80 characters. It is informational. |
| `description` | yes | An i18n message, shown on the app's card. |
| `categories` | yes | At least one. For an app: `commerce`, `hospitality`, `operations`, `crm`, `internal-tools`. Add-ons have their own list; see [Add-on manifests](#add-on-manifests). |
| `capabilities` | no | What the package uses; see [Capabilities](#capabilities). |

:::caution[First-party publishers only]
In this release Adminium accepts only `"publisher": { "id": "adminium", … }`. A manifest from any
other publisher is refused at validation, for apps and add-ons alike.
:::

## Compatibility

```json
"compatibility": {
  "minAdminiumVersion": "0.3.0",
  "engines": ["postgres", "mysql", "sqlite"],
  "requires": ["realtime"]
}
```

| Field | Required | Rule |
|---|---|---|
| `minAdminiumVersion` | yes | The oldest Adminium the package runs on. An install on an older server is refused. |
| `maxAdminiumVersion` | no | An exclusive upper bound. It must be greater than `minAdminiumVersion`. The installer does not enforce it in this release. |
| `engines` | no | The databases the package's tables work on: `postgres`, `mysql`, `sqlite`. At least one when present. Informational in this release. |
| `requires` | no | Capabilities the package cannot run without, from the same list as `capabilities`. Informational in this release. |
| `updatesFrom` | no | The installed versions this release can update in place, as a semver range (`>=0.2.0`, `^0.2.0`, `>=0.2.0 <1.0.0`, `^1.0.0 \|\| >=2.0.0`), up to 120 characters. Absent means any older version. |

Use `updatesFrom` when a release changes its tables in a way an update cannot carry. An install
outside the range is not offered the update, and an update or upload of it is refused with a
message telling the operator to uninstall the old version first. That is better than an update
that fails half-way.

Versions are compared on `major.minor.patch` only: a pre-release tag is ignored, so
`"minAdminiumVersion": "0.3.0-rc.4"` is met by any `0.3.0` build.

When a package starts using a field that an older Adminium does not know, raise
`minAdminiumVersion` to the release that reads it. An older server then tells the operator to
upgrade instead of reporting the manifest as invalid.

## Capabilities

`capabilities` (and `compatibility.requires`) take values from one closed list:

| Value | Meaning |
|---|---|
| `hosted-only` | Only runs on a hosted Adminium. Cannot be combined with `offline-required`. |
| `offline-required` | Must keep working with no network. Cannot be combined with `hosted-only`. |
| `receipt-printer` | Prints receipts. |
| `barcode-scanner` | Reads barcodes. |
| `payments` | Takes payments. |
| `file-storage` | Stores files. |
| `email-delivery` | Sends email. |
| `realtime` | Uses live updates. |
| `outbound-http` | An add-on's server code calls a third-party API. Needs `addOn.network.allow`. |
| `oauth-connect` | Adminium runs an OAuth 2.0 flow for an add-on. Needed by `addOn.connect.kind: "oauth2"`. |

The storefront shows an app's capabilities on its card.

## requiredSchema

`requiredSchema` lists the tables the package needs. Apps must declare it; for add-ons it is
optional. At install Adminium compares it with the operator's database and shows a plan: which
tables it will create, which existing tables it will reuse, and what it needs from the operator
first. Nothing is created until the operator confirms.

```json
"requiredSchema": {
  "prefixed": true,
  "tables": [ … ]
}
```

| Field | Required | Rule |
|---|---|---|
| `tables` | yes | At least one table. Table refs must be unique. |
| `prefixed` | no | `true`, or leave it out. Apps only. |

### Table names and `prefixed`

Without `prefixed`, each table is created under its `ref` exactly (`visits`).

With `"prefixed": true`, Adminium names each table `<key>_<ref>`, with any `-` in the key written
as `_`: the `visits` table of an app keyed `visits` becomes `visits_visits`, and the `tickets`
table of `pos` becomes `pos_tickets`. The full name must fit in 63 characters. The app reads the
real names at runtime from its `surface-config.json` (a `tables` map from each ref to its real
name), so its code never hard-codes the prefix. Pages, rules, roles and public endpoints in the
manifest always use the short refs; Adminium maps them.

Prefixing is opt-in because an app built before it existed hard-codes its table names. New apps
should use it. No table may end up in Adminium's own `adminium_` namespace.

### What the plan does with each table

Every table in `requiredSchema` falls into one of four cases:

| Case | When | Default action |
|---|---|---|
| New | Nothing with that name exists. | Create it. |
| This app's own | An earlier install of the same app recorded it. | Reuse it. |
| Shared | Another installed app recorded it under the same [`shape`](#tables). | Share it. |
| Taken | It exists and no install records it as this app's. | The operator chooses before installing. |

For a taken table the operator can **reuse** it (offered only when the table has no required
column that the app would never fill), **rename the existing table** out of the way (to
`<name>_old` unless they choose a name), or give the whole app **a different prefix**, which
applies to every table at once and is meaningful for a prefixed app.

A reused or shared table may need changes first. The plan offers only changes that cannot lose
data: adding a missing column (created nullable), widening a type (a longer `varchar`, `varchar` to
`text`, `int` to `bigint`), making an integer key number itself, and adding enum values. A missing
`id`, `fk` or `blob` column cannot be added to an existing table, and a column whose type cannot
hold the app's values is refused by name.

A foreign key's target must be one of the package's own tables or a table that already exists in
the database.

### Tables

| Field | Required | Rule |
|---|---|---|
| `ref` | yes | snake_case. The table's short name. |
| `columns` | yes | At least one. Column refs must be unique within the table. |
| `label` | no | A [label](#conventions) for one row ("Category"): form titles, buttons, empty states, link fields. Without it Adminium names the table from its real name. |
| `labelPlural` | no | A label for the table ("Categories"). Needs `label`. |
| `keyField` | no | The column that names a row wherever another table links to it (a category's `name`). Must be one of the table's columns. |
| `shape` | no | `<name>@<version>`, such as `menu@1`. Two apps that declare the same shape on a table can use one table between them. |
| `capacity` | no | A limit on how much of a time slot the table's rows may take; see [Capacity](#capacity). |
| `booking` | no | Rows that book a person's time, never overlapping; see [Booking](#booking). A table has `capacity` or `booking`, not both. |

`label`, `labelPlural`, `keyField` and every column `label` are installed as the operator's own
labels would be. The operator can rename anything; a name they changed is theirs, and a later
version of the app does not overwrite it.

### Columns

```json
{ "ref": "status", "type": "enum", "enum": ["open", "paid", "void"], "default": "open",
  "label": { "en-US": "Status", "de-DE": "Status" } }
```

| Field | Required | Rule |
|---|---|---|
| `ref` | yes | snake_case. |
| `type` | yes | One of the [column types](#column-types). |
| `nullable` | no | `true` makes the column nullable. **Columns are `NOT NULL` unless you say otherwise.** A primary key is never nullable. |
| `role` | no | `pk` (primary key), `created_at` or `updated_at`. |
| `semantic` | no | A hint for widgets: `name`, `money`, `image`, `email`, `avatar`, `geo-lat`, `geo-lng`. |
| `enum` | for `enum` | The allowed values, at least one. |
| `references` | for `fk` | The `ref` of the table this foreign key points at. That table must declare exactly one `pk` column; the foreign key takes its type. |
| `maxLength` | no | `text` only: creates `varchar(n)` instead of unbounded text. 1–1000. |
| `default` | no | The value the database fills when an insert leaves the column out. See [Defaults](#defaults). |
| `unique` | no | `true`: no two rows may hold the same value. Empty values do not count, so many rows may leave it empty. Not on the primary key, a `json` or a `blob` column; a `text` column needs `maxLength`, because MySQL cannot index unbounded text. |
| `label` | no | A [label](#conventions) for the column: a form field, a list heading. |
| `rules` | no | Rules Adminium keeps on the column; see [Column rules](#column-rules). |

A `NOT NULL` column with no default refuses every insert that leaves it out, which includes every
record added from a form that does not show it. Give such columns a `default`, or make them
`nullable`.

`unique` becomes a unique constraint named `uq_<table>_<column>`, where `<table>` is the real
table name (`uq_clinic_patients_email`). It is made when Adminium creates the table. A column
added to a table that already exists, by an update or on a reused table, gets no constraint.

#### Column types

| Type | Created as |
|---|---|
| `id` | A string key (`varchar`). |
| `int`, `bigint` | Integer. With `role: "pk"`, the key numbers itself (an identity or auto-increment column); an explicit value is still accepted. |
| `text` | `text`, or `varchar(maxLength)`. A column with a `code` rule is exactly as wide as its codes. |
| `decimal`, `money` | Decimal. |
| `float` | Floating point. |
| `bool` | Boolean. |
| `enum` | A `varchar(32)` (or `varchar(64)` when a value is longer than 32 characters) with a check that limits it to the `enum` values. |
| `json` | JSON. |
| `date` | Date. |
| `timestamptz` | Timestamp with time zone. |
| `uuid` | UUID. |
| `fk` | A foreign key, typed like its target's primary key. |
| `blob` | Binary. |

#### Defaults

A default must mean the same thing on Postgres, MySQL and SQLite, so only these are accepted:

- `timestamptz`: only the string `"now"`.
- `text`: a string, and the column needs `maxLength` (MySQL gives unbounded text no default). The
  default must fit in it.
- `enum`: one of its values.
- `int`, `bigint`: a whole number. `decimal`, `money`, `float`: a number.
- `bool`: `true` or `false`.
- `json`, `blob`, `date`, `id`, `uuid`, `fk` and primary keys take no default.

### Column rules

`rules` asks Adminium to keep rules on a column. They are written at install as the operator's own
column rules would be. An operator's existing rule on the same column wins, and a rule they later
change or delete is theirs from then on.

| Rule | Shape | What it does |
|---|---|---|
| `options` | `{ "list": "<name>" }` or `{ "values": [{ "value", "label"?, "tone"? }] }` | The allowed values. `list` names one of the app's [option lists](#option-lists), or a built-in list: `builtin:countries`, `builtin:us-states`, `builtin:gender`. Inline `values` take 1–500 entries. An inline value's `label` is a [label](#conventions): a keyed one follows the reader's language in the form's choices, the filters, the list and dashboard cards, falling back to `en-US`. An app's option list keeps its `en-US` words. |
| `enumLabels` | `{ "labels": { "<value>": label }, "tones"?: { "<value>": "<tone>" } }` | Display labels (and badge tones) for an enum's values. Each label is a [label](#conventions): a keyed one follows the reader's language on pages (the list, the record and the form), and on dashboard cards, falling back to `en-US`. A page that sets its own labels or tones for the column keeps them. |
| `required` | `true` | The server requires a value on every write. |
| `validation` | `{ "format"?, "min"?, "max"?, "minLength"?, "maxLength"? }` | `format` is `email`, `url` or `phone`. |
| `copy` | `{ "via", "from", "mode"? }` | Copies a value from a linked row. `via` is a foreign-key column of this table, `from` a column of the table it points at. With `mode: "default"` (the default) the copy fills only a value the write leaves out; with `"always"` it always wins. |
| `sequence` | `{ "start"? }` | The next number in this column's own counter. `start` is at least 1. |
| `code` | `{ "length", "prefix"? }` | A short random code, unique in the column. `length` is 4–12; `prefix` is upper case, up to 6 characters plus an optional `-` (`MR-`). |
| `rollup` | `{ "from", "via", "sum", "times"?, "unlessSet"?, "where"?, "balance"?, "cap"? }` | A total over child rows, kept up to date as they change. `from` is the child table, `via` its foreign key back to this table, `sum` the column to add up. `times` multiplies each row (a quantity); a child row with a value in `unlessSet` is left out (a voided line). See [Totals and balances](#totals-and-balances) for `where`, `balance` and `cap`. |
| `stamp` | `{ "set", "on" }` | A value Adminium writes when something happens: the moment, or who did it. See [Stamps](#stamps). |
| `venueLocal` | `true` | A wall time given with no zone is read in the venue's time zone. |
| `personal` | `true` or `false` | Whether the column is personal data, overriding the guess Adminium makes from the column's name. |

Tones are the dashboard's badge colours: `neutral`, `accent`, `info`, `pos`, `warn` and `danger`.

`copy`, `sequence`, `code`, `rollup` and `stamp` are values **Adminium decides**: they are filled
on the server, so a browser never picks a price, a number, a code or a time. So are a rollup's
`balance` column and a booking's late-cancellation [`flag`](#booking). None of them can be listed as
`writable` in [public access](#public-access), and a primary key cannot take `sequence` or `code`.

Every name a rule uses is checked against the manifest: `copy.via` must be a foreign key of the
table, `rollup.via` must point back at this table, and so on.

```json
{ "ref": "subtotal", "type": "money", "default": 0,
  "rules": { "rollup": { "from": "ticket_items", "via": "ticket_id", "sum": "unit_price",
                         "times": "qty", "unlessSet": "voided_at" } } }
```

#### Totals and balances

A rollup can also filter its child rows, keep a balance beside the total, and refuse a change
that would take the balance below zero: what a visit's fee, its payments and its write-offs need.

| Field | Rule |
|---|---|
| `where` | `{ "column", "eq" }`: only child rows whose column equals the value are added up (`voided` is `false`). The value must fit the column, and the column must not be nullable: a row left empty would drop out of the total unseen. |
| `balance` | `{ "column", "of", "minus"? }`: a second column of this row, kept as `of − minus… − total` (`balance = fee − waived − paid`). `minus` lists up to 4 columns. Every column named is a number column of this table, and the balance is a column of its own, with no rules of its own. |
| `cap` | `true`: a child write that would take the balance below zero is refused. It needs a `balance` on the same rollup, or a balance elsewhere on the row whose `minus` lists this total (a write-off is capped by the balance it lowers). |

```json
{ "ref": "paid", "type": "money", "default": 0,
  "rules": { "rollup": { "from": "payments", "via": "visit_id", "sum": "amount",
                         "where": { "column": "voided", "eq": false },
                         "balance": { "column": "balance", "of": "fee", "minus": ["waived"] },
                         "cap": true } } }
```

A capped write is refused with `BALANCE_EXCEEDED` and the balance it would have gone below. So is a
change to the parent that lowers `of` under what is already paid. Only a write that takes the
balance below zero, or further below it, is refused: a row already negative from older data can
still be edited or voided. Two payments at once are judged one after the other, so they cannot
both pass.

A write that touches several rows of a table feeding a capped total is refused with
`BALANCE_ONE_AT_A_TIME`, because it cannot be judged row by row. Imports and sample data are
settled but not capped: they record what already happened.

A total or a balance a writer sends is dropped, not refused, so a form that sends the whole row
still saves.

#### Stamps

A stamp writes a value when a row is created, or when another column changes to one of a list of
values: the time a patient checked in, who took a payment.

```json
{ "ref": "checked_in_at", "type": "timestamptz", "nullable": true,
  "rules": { "stamp": { "set": "now", "on": { "column": "status", "values": ["checked_in"] } } } }
```

| Field | Rule |
|---|---|
| `set` | `"now"` (a `timestamptz` column), `"user-name"` or `"user-id"` (a `text` column), or `{ "byOrigin": { "public", "staff" } }`: one value for a write through the public API and another for everyone else. Both values must fit the column. |
| `on` | `"create"`, or `{ "column", "values" }`: another column of the table, and 1–16 values it must change to. |

A change is judged against the stored row, so sending a status the row already holds stamps
nothing again. A create that already holds one of the values (a walk-in written as checked in)
is stamped too. A stamp wins over a value the writer sent.

A public write stamps the time and a `byOrigin` value, but never a person: a browser key is
nobody. For an automation, `user-name` is the rule's name. Imports, sample data and undo stamp nothing, since a
stamp of today's time over history would be false. A stamped column takes no `copy`, `sequence`,
`code` or `rollup` as well.

### Capacity

`capacity` limits how much of a time slot a table's rows may take: the guard behind a booking
form. Numbers can be literal, or read from the app's one-row settings table as
`{ "table": "<ref>", "column": "<ref>" }`, so a venue can change them without a new release.

| Field | Required | Rule |
|---|---|---|
| `slot` | yes | The column holding each row's time. |
| `amount` | yes | The column holding how much a row takes (a party size). |
| `perSlot` | yes | How much one slot holds. A non-negative integer, or a settings reference. |
| `slotMinutes` | yes | Slot length in minutes, or a settings reference. |
| `countWhere` | no | `{ "column", "values" }`: only rows whose column holds one of these values count (a cancelled booking holds no seats). |
| `windowDays` | no | How many days ahead bookings are open. |
| `opens`, `closes` | no | `"HH:MM"`, or a settings reference. |
| `resource` | no | A column (a table, a room): the limit applies per value of it too. |
| `cancelHours` | no | Until how many hours before its time a guest may still cancel through the public API. Staff are never held to it. |

### Booking

`booking` books a person's time rather than seats: each row takes a resource (a clinician) for its
own length, and two counted rows of one resource may never overlap. The time must also fall
inside that resource's hours, off their break, on the booking grid and outside any closure.
Capacity adds up a party per start time; booking forbids overlap per resource. They answer
different questions, so a table has one or the other, never both.

Every table the rule names is one of the app's own, by its short ref. A number can be literal or
read from the settings table as `{ "table", "column" }`, as in [Capacity](#capacity). For how the
pieces fit together, see [Booking rules](/guides/apps/booking-rules/).

```json
"booking": {
  "start": "starts_at", "minutes": "minutes", "resource": "clinician_id", "kind": "visit_type_id",
  "countWhere": { "column": "status", "values": ["booked", "checked_in", "seen"] },
  "eligible": { "table": "clinician_visit_types", "resource": "clinician_id", "kind": "visit_type_id",
                "order": { "table": "clinicians", "column": "position", "active": "active", "public": "online" } },
  "hours": {
    "practice": { "table": "opening_hours", "weekday": "weekday", "opens": "opens", "closes": "closes",
                  "breakStart": "break_start", "breakEnd": "break_end", "open": "open" },
    "own": { "table": "clinician_hours", "resource": "clinician_id", "weekday": "weekday",
             "opens": "opens", "closes": "closes" }
  },
  "closures": { "table": "closures", "from": "from_date", "to": "to_date", "resource": "clinician_id" },
  "grid": { "table": "settings", "column": "grid_minutes" },
  "windowDays": 60,
  "noticeMinutes": 120,
  "cancel": { "hours": 24, "mode": "flag", "flag": "late_cancel",
              "when": { "column": "status", "to": "cancelled" } }
}
```

| Field | Required | Rule |
|---|---|---|
| `start` | yes | A `timestamptz` column: when the row starts, read in the venue's time zone. |
| `minutes` | yes | An `int` column: how long the row lasts. Usually a `copy` from the kind. |
| `resource` | yes | A foreign key: whose time the row takes. Left empty on a create, it means anyone: Adminium picks the first free person in `eligible.order`. |
| `kind` | yes | A foreign key: what the row is, which decides who may be booked for it. |
| `countWhere` | yes | `{ "column", "values" }`: only rows whose column holds one of these values take time (a cancelled visit takes none). Each value must fit the column. |
| `eligible` | yes | Who does what: `{ "table", "resource", "kind", "order"? }`, a link table whose two foreign keys point where the row's `resource` and `kind` point. A person with no link row for a kind is never booked for it. |
| `eligible.order` | no | `{ "table", "column", "active"?, "public"? }`, kept on the table `resource` points at. `column` is a number: the order in which "anyone" picks. A person whose `active` bool is false is never booked; one whose `public` bool is false is never booked through the public API. |
| `hours.practice` | yes | Weekly hours: `{ "table", "weekday", "opens", "closes", "breakStart"?, "breakEnd"?, "open"? }`, one row per weekday. `weekday` is an enum of exactly `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`, in that order. The times are `text` columns holding `HH:MM`. A break names both its start and its end. `open` is a bool. |
| `hours.own` | no | A person's own weekly hours, the same shape plus `resource`, a foreign key to the person. A person with rows here follows them every day, and a weekday with no row is a day off. A person with none follows the practice's hours. |
| `closures` | no | Dated closures: `{ "table", "from", "to", "resource"?, "active"? }`. `from` and `to` are `date` columns. `resource` must be nullable: an empty one closes for everyone. `active` is a bool. |
| `grid` | yes | The minutes between bookable starts, counted from the opening time. At least 1. |
| `windowDays` | no | How many working days ahead a booking may be made. |
| `noticeMinutes` | no | How far ahead a public booking must be. Staff are never held to it. |
| `cancel` | no | Late cancellation: `{ "hours", "mode", "flag"?, "when" }`. See below. |

`cancel.when` is `{ "column", "to" }`: a cancellation is a change of the `countWhere` column to a
value that does not count. Inside `hours` of the start, `mode: "refuse"` turns a guest's
cancellation away, and `mode: "flag"` lets it through and sets `flag`, a bool column of the table,
whoever cancels. `flag` is required with `"flag"` and not allowed with `"refuse"`. A guest can never
move a booking inside the window, in either mode. Staff are never refused.

Nothing may start in the past, with one exception: staff may create a walk-in in the slot that
holds the current time, when its status is a counted value other than the first in `countWhere`
(`checked_in` rather than `booked`).

The public API answers a clash with `PUBLIC_SLOT_FULL`; a time outside hours, on a closure,
beyond the window or with nobody offered for the kind with `PUBLIC_WRITE_REFUSED`; and a guest's
late move, or a late cancellation in `refuse` mode, with `PUBLIC_TOO_LATE`. An
[`availability`](#public-access) entry on a booking table lists the free times of a day, or a
strip of days, for a kind.

## Option lists

`optionLists` ships lists of answers a column can name with `options: { "list": "<name>" }`. It is
an object keyed by kebab-case list name.

```json
"optionLists": {
  "zones": {
    "label": { "en-US": "Zones", "de-DE": "Bereiche" },
    "values": [
      { "value": "Window", "label": { "en-US": "Window", "de-DE": "Fenster" } },
      { "value": "Patio", "tone": "info" }
    ]
  }
}
```

Each list has a `label` and 1–500 `values`, each with a `value` (1–256 characters) and an optional
`label` and `tone`. A list is installed once as `<key>-<name>` (`pos-zones`). The operator can edit
it like any other list, so a later version never overwrites it, and a list of that key someone
already made is left alone.

## Pages

`pages` declares the dashboard pages an app adds. An app needs at least one. Each page is built at
install over the app's real table, with the same generator the dashboard's own create screen uses,
and appears in the app's own sidebar section.

```json
{
  "ref": "pos-menu",
  "template": "page-crud",
  "title": { "key": "mft.pos.page.menu", "fallback": "Menu" },
  "titles": { "de-DE": "Speisekarte", "fr-FR": "Carte" },
  "nav": { "group": "manage", "icon": "utensils", "order": 1 },
  "bindings": { "rows": "menu_items" }
}
```

| Field | Required | Rule |
|---|---|---|
| `ref` | yes | kebab-case. It becomes the page's address, `/p/<ref>`. Every app installed on the same database shares these addresses, so start it with the app key (`pos-menu`). The plan refuses an install whose page ref another app's page already uses there. |
| `template` | yes | The page template; see below. |
| `title` | yes | An i18n message. `fallback` is the English title. |
| `titles` | no | The title in other languages, keyed by BCP 47 tag, each 1–120 characters. The sidebar shows the operator's language until the operator renames the page. |
| `nav` | yes | `{ "group", "icon", "order" }`. `group` is 1–80 characters, `icon` a [Lucide](https://lucide.dev/icons/) icon name (1–60 characters), `order` an integer. |
| `bindings` | no | Which of the app's tables the page reads: an object from a page-local name to a `requiredSchema` table ref. |
| `config` | no | Page configuration: a `form` for a record page, a `layout` for `page-dashboard`, a `calendar` for `page-calendar`. |

**Templates.** A table-bound template reads one table: `page-crud`, `page-board`,
`page-calendar`, `page-scheduler`, `page-directory`, `page-master-detail`, `page-queue-inbox`,
`page-log-viewer`, `page-files` and `page-chat`. Give it `bindings`. A single entry names its table
whatever its key (`{ "items": "menu_items" }`); with several entries, the one keyed `rows` is the
page's own table. `page-dashboard` reads from several tables and takes its widgets from
`config.layout`.

**Config.** `config.form` and `config.layout` name the app's tables and columns by their short
refs; Adminium binds them to the real tables at install. The plan refuses a form or layout that is
not well formed or that names a column or table the manifest does not declare. Other problems do
not block the install: a page with no `bindings`, an unknown template, or a table that cannot back
its template gives a page that is created empty and says so, and the install report lists it.

A form's chips field (`"control": "reference-chips"`) may name the table it picks from or the
link table between the two (`"relation": "clinician_visit_types"`). A link table is one that
holds the two foreign keys and nothing else to fill, with or without its own `id`. A field the
install cannot bind is listed in the install report, and the page gets the form Adminium makes. A
designed field the form cannot show says so in its place.

`config.calendar` names the columns a `page-calendar` plots by:

```json
"config": { "calendar": { "start": "starts_at", "title": "patient_id.name", "category": "visit_type_id" } }
```

| Field | Required | Rule |
|---|---|---|
| `start` | yes | A `date` or `timestamptz` column of the page's table: where each row is plotted. |
| `end` | no | A `date` or `timestamptz` column: where a row that spans time ends. |
| `title` | no | A column of the page's table, or `<fk column>.<column>`: a column of the table that foreign key points at (the patient's name). |
| `category` | no | A column of the page's table: what the rows are coloured and filtered by. |

The manifest is refused when a name is not a column of the right table and type. Without
`calendar`, a table with a booking rule is plotted by the booking's `start`; any other table by
the first date Adminium finds. On a page with a `form`, **Add event** and a click on an empty day
open that form, with the day filled in.

**Updates.** A page nobody has edited is rebuilt when the app is updated. A page the operator
edited is left as they left it. Uninstalling an app does not delete its pages.

### navGroups

`navGroups` names the headings inside the app's sidebar section. Up to 12.

```json
"navGroups": [
  { "key": "manage", "label": { "en-US": "Manage", "de-DE": "Verwalten" }, "order": 1 },
  { "key": "records", "label": { "en-US": "Records", "de-DE": "Aufzeichnungen" }, "order": 2 }
]
```

Each group has a kebab-case `key`, a keyed [label](#conventions) (must include `en-US`) and an
integer `order`. A page whose `nav.group` is one of these keys is listed under that heading, in
`nav.order`. A page whose group is not declared (an Overview, say) is listed first, with no
heading.

## Frontends

`frontends` declares the app's own screens: a **staff** side, a **customer** side, or both. At
least one is required, and each side may appear once. The Adminium dashboard itself is always
there and is not declared.

```json
"frontends": [
  { "side": "staff", "kind": "spa", "entry": "index.html",
    "routes": { "pos": "/" }, "placement": "external" },
  { "side": "customer", "kind": "spa", "entry": "index.html",
    "routes": { "book": "/", "manage": "/manage" } }
]
```

| Field | Required | Rule |
|---|---|---|
| `side` | yes | `staff` or `customer`. |
| `kind` | yes | `spa`, `electron` or `none`. |
| `entry` | no | The frontend's entry file (`index.html`). |
| `env` | no | The environment variables the frontend reads, each `{ "required": boolean, "example"?: string }`. |
| `routes` | no | The views this side owns, from a view name to a path. |
| `placement` | no | Staff side only: `internal` opens the screens inside the dashboard, `external` on their own address (a till). The operator can change it. Absent means `internal`. |
| `enabled` | no | Whether the side starts switched on. Absent means on. |

Adminium serves each side at `/apps/<key>/<side>/`. The staff side needs a signed-in user; the
customer side is public and calls the [public API](/guides/public-api/endpoints-and-keys/) with the
app's `customer` browser key, which the install creates. A staff side can be handed a second key
for a screen of its own; see [publicKeys](#publickeys). Each side reads its `surface-config.json` at boot: the real table
names, the app's settings and, for the staff side, the connection, the venue's time zone and
currency, who is signed in, and `access`: which of `read`, `create`, `update` and `delete` they
hold on each of the app's tables, and the app's roles they hold. A staff screen uses it to leave
out a button whose write would be refused; the data API still checks every write.

## Roles

`roles` declares roles the app brings, such as a cashier and a manager. Each is installed as
`<key>-<role key>` (`pos-cashier`) and belongs to the app.

```json
{
  "key": "cashier",
  "name": "POS cashier",
  "screensOnly": true,
  "permissions": ["table:@tickets:read", "table:@tickets:create", "page:@pos-menu:view", "app:@:staff"]
}
```

| Field | Required | Rule |
|---|---|---|
| `key` | yes | kebab-case. The full `<key>-<role key>` must fit in 40 characters. |
| `name` | yes | 1–80 characters. |
| `permissions` | no | Grants, in the forms below. |
| `cloneFrom` | no | The key of another of this app's roles, whose grants this role also gets, and its `limits`. |
| `screensOnly` | no | `true`: people with this role open the app's own screens and never the dashboard. |
| `limits` | no | Per table ref, what the role's `update` there may change. See below. |

A manifest cannot know the real table names or page ids, so it grants through placeholders:

| Grant | Actions |
|---|---|
| `table:@<table ref>:<action>` | `read`, `create`, `update`, `delete`, `export`, `import`, `read_pii` |
| `page:@<page ref>:<action>` | `view`, `edit` |
| `app:@:staff` | Open the app's staff screens. |

`read_pii` shows the table's personal columns in clear. Without it they read as `null`, listed in
the row's `_masked`. A lookup into another table needs `read_pii` on that other table. See
[Personal data](/guides/apps/roles-and-staff-access/#personal-data).

The plan refuses a `system:` grant, a wildcard, and a reference to a table or page the manifest
does not declare. Grants are given once: an update adds what a new version asks for, and an
operator's narrowing of an app role survives it.

`limits` narrows the role's `update` on a table to some columns and, for some of those, to some
values. The names are the ones [public access](#public-access) uses:

```json
{
  "key": "clinician",
  "name": "Clinician",
  "permissions": ["table:@appointments:read", "table:@appointments:update", "app:@:staff"],
  "limits": {
    "appointments": {
      "writable": ["status"],
      "writableValues": { "status": ["roomed", "with_clinician", "ready"] }
    }
  }
}
```

| Field | Required | Rule |
|---|---|---|
| `writable` | yes | The columns the update may change, at least one. |
| `writableValues` | no | For a column in `writable`, the only values it may set (1–32, each a value of the column). |

The table must be one the app declares, and the role must grant `table:@<ref>:update` itself or
through `cloneFrom`. Someone who also holds a role with an unlimited update on the table is not
limited. Creating rows is not limited. Every install and update writes the manifest's current
limits. See [Edits limited to some columns](/guides/apps/roles-and-staff-access/#edits-limited-to-some-columns).

A role that signs in a staff-bound browser key (a check-in tablet; see [publicKeys](#publickeys))
must be `screensOnly`, with no `cloneFrom` and no grant but `app:@:staff`.

## Settings

`settings` declares values the operator sets for the app, such as a business type or a currency.
They appear on the app's settings page, and the app reads them, with their defaults, from
`surface-config.json`.

```json
{ "key": "business_type", "type": "enum", "enum": ["restaurant", "retail"], "default": "restaurant",
  "label": { "key": "mft.pos.setting.businessType", "fallback": "Business type" } }
```

Every setting has a snake_case `key`, a `type`, and optionally `required`, `secret`, a `label` and
a `help` sentence shown under the field (both i18n messages). By type:

| `type` | Extra fields |
|---|---|
| `string` | `default` (string) |
| `number` | `default`, `min`, `max` (numbers), `unit` (up to 20 characters) |
| `boolean` | `default` (boolean) |
| `enum` | `enum` (at least one value, required), `default` (string) |
| `file` | `accept` (a list of accepted types) |
| `json` | `default` (any JSON) |

A setting marked `secret` is never sent to an app's screens. In this release an app's settings page
does not show or store secret settings; they are used by add-ons.

## Emails

An app declares the emails it sends with two blocks: `outbox`, which names one of its tables as
the outbox and says what queues rows in it, and `emailTemplates`, the templates those rows are
sent with. For a walk-through, see [Emails](/guides/apps/emails/).

The outbox table is the log. Every email is a row in it, queued by a producer below, by the app's
own screens or by the operator. Adminium sends queued rows and records the outcome on each:
`sent` once the message is handed to the mail queue, `skipped` when there is nothing to send to
("No email on file", or a reserved example address), and `failed` with a reason. A row already
there for the same kind and source is what stops a second send.

### outbox

```json
"outbox": {
  "table": "messages",
  "columns": { "kind": "kind", "status": "status", "to": "to_address", "language": "language",
               "due": "due_at", "sentAt": "sent_at", "error": "error" },
  "links": { "appointment": "appointment_id", "patient": "patient_id" },
  "recipient": { "via": "patient_id", "table": "patients", "email": "email", "name": "name",
                 "language": "language", "optIn": "reminders",
                 "fallback": { "via": "appointment_id", "email": "new_email", "name": "new_name" } },
  "settings": { "table": "settings", "enabled": "emails_on", "name": "practice_name", "phone": "phone" },
  "pages": { "manage": "/my-visits", "booking": "/" },
  "kinds": { "confirmation": "clinic-confirmation", "reminder": "clinic-reminder" },
  "producers": [
    { "kind": "confirmation", "link": "appointment_id", "gate": "enabled",
      "onCreate": { "table": "appointments" } },
    { "kind": "reminder", "link": "appointment_id", "gate": "enabled", "optIn": true,
      "before": { "table": "appointments", "at": "starts_at",
                  "lead": { "via": "patient_id", "table": "patients", "column": "reminder_hours",
                            "fallback": { "table": "settings", "column": "reminder_hours" }, "max": 72 },
                  "where": { "column": "status", "eq": "booked" } } }
  ]
}
```

| Field | Required | Rule |
|---|---|---|
| `table` | yes | One of the app's tables: the outbox. |
| `columns` | yes | The outbox's columns. `kind` is an enum of the kinds. `status` is an enum holding at least `queued`, `sent`, `failed` and `skipped`. `to` is `text`, the address. Optional: `language` (`text`), `due` (`timestamptz`, required by a `before` producer), `sentAt` (`timestamptz`) and `error` (`text`). |
| `links` | no | The outbox's foreign keys, by the name a template reads them under: `{ "appointment": "appointment_id" }` gives a template `appointment.*`. Names are snake_case. Every foreign key of the outbox table that the outbox names must be nullable: not every email is about one. |
| `recipient` | yes | Who the email goes to. See below. |
| `settings` | no | The app's one-row settings table: `{ "table", "enabled"?, "name"?, "phone"? }`. Templates read it as `practice.*`. `enabled` is a bool that pauses producers with `gate: "enabled"`. `name` is a `text` column the app's emails are signed with, the [emailed code](#public-access) included; without it, the workspace's name is used. `phone` is a `text` column: when it holds a number, the notice sent to a person's old address after a change of email tells them to ring it; without one, the notice says to contact you. |
| `pages` | no | `{ "manage"?, "booking"? }`: paths on the app's customer side (`/my-visits`) that a template's `manage_url` and `booking_url` lead to. Up to 120 characters. Default: the side's front page. |
| `kinds` | yes | Each value of the kind column, and the key of the template it is sent with. Every value must be one of the enum's, and every template one of `emailTemplates`. |
| `producers` | no | Up to 16 rules that queue rows by themselves. See below. |

**`recipient`** is `{ "via", "table", "email", "name"?, "language"?, "optIn"?, "fallback"? }`.
`via` is the outbox's foreign key to the person, `table` the person's table, and the rest are its
columns: `email`, `name` and `language` are `text`, and `optIn` is a bool the person sets (false
means nothing from a producer that asks `optIn`). `fallback` is `{ "via", "email", "name"?, "language"? }`: where the address
comes from when `via` is empty. Its `via` is another foreign key of the outbox, and its columns
belong to the table that key points at; a first visit by someone not yet on file carries their
details on the visit itself.

**Producers.** Each has a `kind` (a key of `kinds`) and a `link`, the outbox's foreign-key column
that points at the row that produced it and must be one of `links`. Optionally `gate: "enabled"`
(needs `settings.enabled`) and `optIn: true` (needs `recipient.optIn`: a person who opted out gets
nothing). Then exactly one of:

| Producer | Shape | Queues a row |
|---|---|---|
| `onCreate` | `{ "table", "where"? }` | When a row of the table is created. |
| `onChange` | `{ "table", "column", "to", "where"? }` | When the column changes to `to`, a value or a list of 1–16 values. |
| `before` | `{ "table", "at", "lead", "where"? }` | A lead time before `at`, a `timestamptz` of the row: a reminder. |

`where` is one condition on the source row: `{ "column", "eq" }`, `{ "column", "in": [values] }`
or `{ "column", "isNull": true|false }`, exactly one of the three. `before.lead` is
`{ "via", "table", "column", "fallback"?, "max" }`: the number of hours before, read from `column`
(an `int`) of the row that `via` points at, else from the settings `fallback`, and never more
than `max` hours (1–336). `max` is also how far ahead Adminium looks. A reminder is queued with
its moment in `columns.due`.

A source row produces each kind once. A reminder is produced again only when its moment moves.
Sample data, imports and undo never queue an email.

### emailTemplates

Up to 16 templates. Each is stored as the app's: an operator can edit it, and an edited template
is kept as they left it across updates and uninstalls. A template a new version no longer ships is
removed if nobody edited it.

```json
{
  "key": "clinic-reminder",
  "name": { "en-US": "Visit reminder", "de-DE": "Terminerinnerung" },
  "vars": ["recipient.first_name", "appointment.starts_at.relative_day", "manage_url"],
  "locales": {
    "en-US": {
      "subject": "Your visit {{appointment.starts_at.relative_day}}",
      "blocks": [
        { "block": "email.text", "data": { "text": "Hello {{recipient.first_name}}, see you {{appointment.starts_at.relative_day}} at {{appointment.starts_at.time}}." } },
        { "block": "email.button", "data": { "label": "Manage your visit", "url": "{{manage_url}}" } }
      ]
    }
  }
}
```

| Field | Required | Rule |
|---|---|---|
| `key` | yes | kebab-case, 2–80 characters, starting with the app's key and `-` (`clinic-reminder`). Unique in the manifest. |
| `name` | yes | A plain string or a keyed [label](#conventions). |
| `vars` | no | Up to 60 variable names the template reads, for the editor's list. |
| `locales` | yes | The template in each language it ships, keyed by BCP 47 tag. `en-US` is required. |

Each language is `{ "subject", "preheader"?, "blocks", "footer"? }`: a subject and a preheader of
up to 200 characters, 1–40 blocks, and a footer of up to 1000. A block is
`{ "block", "id"?, "label"?, "data"? }`, where `block` is an email block kind such as `email.text`,
`email.heading` or `email.button`. `email.html` is refused: its variables are not escaped, and an
app's emails show values a stranger typed. The install's check step refuses a block kind the
renderer does not know, or data of the wrong shape.

A template reads variables as `{{name}}`: each link by its name (`appointment.*`, and one foreign
key further, such as `appointment.clinician.*`), `recipient.name` and `recipient.first_name`,
`practice.*`, `appName`, `manage_url` and `booking_url`. A time has the forms `.date`, `.time`,
`.day_month` and `.relative_day` ("tomorrow"), in the recipient's language and the venue's zone.
The guide lists [every variable](/guides/apps/emails/).

Templates are sent through an outbox, so a manifest with `emailTemplates` and no `outbox` is
refused. The install's check step warns when the server cannot send email.

## Public access

`publicAccess` says what the app's public screens may do. Each entry becomes an endpoint of the
[public API](/guides/public-api/endpoints-and-keys/) on the real table, served through one of the
app's browser keys and marked as the app's: switching the app off stops it and uninstalling
removes it. Up to 32 entries.

An entry is served through the app's `customer` key unless it names another in `key`. The install
creates one key for `customer` and one for each name in [`publicKeys`](#publickeys). A key the
operator revoked is not made again by an update.

```json
"publicAccess": [
  { "table": "booking_rules", "methods": ["GET"], "select": ["opens", "closes", "slot_minutes"] },
  { "table": "reservations", "kind": "availability", "methods": ["GET"] },
  { "table": "reservations", "methods": ["POST"],
    "select": ["id", "code", "starts_at", "status"],
    "writable": ["party_size", "starts_at", "name", "mobile", "email"],
    "defaults": { "status": "confirmed", "channel": "online" },
    "confirm": { "template": "booking-confirmation", "to": "email", "code": "code",
                 "when": "starts_at", "link": "manage?code={code}" } },
  { "table": "reservations", "methods": ["GET", "PATCH"],
    "claim": { "match": ["code", "mobile"] },
    "writable": ["starts_at", "party_size", "status"] }
]
```

| Field | Required | Rule |
|---|---|---|
| `table` | yes | One of the app's table refs. |
| `methods` | yes | At least one of `GET`, `POST`, `PATCH`. `PATCH` needs a `claim`, or a `claimedBy` that is not `optional`. |
| `kind` | no | `records` (the default) or `availability`. |
| `key` | no | The browser key that serves the entry: `customer` (the default) or a name in [`publicKeys`](#publickeys). |
| `select` | no | The columns a response carries. Default: every column the app declares for the table. An entry with `claimedBy` must list them. |
| `writable` | no | The columns a create or change may set. Never a column whose value Adminium decides. |
| `writableValues` | no | `{ "<column>": [1–32 values] }`: the only values a browser may write into a writable column, on a create or a change. Each value must fit the column. |
| `writableWhen` | no | `{ "<column>": [1–32 values] }`, `{ "<column>": "from-now" }` or `{ "<column>": { "within": <minutes> } }`: the state a row must be in to be changed. `"from-now"` needs a `timestamptz` and means "still ahead". `within` needs a `timestamptz` and means "no more than that many minutes ahead" (1–1440; a past time always passes); at most one per entry. Needs `PATCH`. |
| `filters` | no | Rows the endpoint can reach at all. See [Filters](#filters). |
| `defaults` | no | Values the server writes whatever the browser sends. |
| `claim` | no | `{ "match", "verify"?, "email"? }`. Makes the entry its key's identity. See [A person's own rows](#a-persons-own-rows). |
| `claimedBy` | no | `{ "table", "column", "optional"? }`. The entry reaches only the rows of the person its key's identity claimed. |
| `level` | no | `lookup` (the default) or `verified`: the session the entry needs. Only with `claimedBy`. |
| `sensitive` | no | Whether the rows need a verified session to see. See [A person's own rows](#a-persons-own-rows). |
| `reason` | with `sensitive: false` | Why the entry is not sensitive, 1–200 characters. Only with `sensitive: false`. |
| `onClaim` | no | `{ "clear": [1–12 columns] }`: on an entry whose `claimedBy` is `optional`, the nullable columns a signed-in create empties (the name and number a first visit would type). |
| `maxOpen` | no | `{ "column", "values", "n", "upcoming"? }`: a claimed person may hold at most `n` (1–50) rows whose column holds one of `values`. With `upcoming`, a `timestamptz`, only rows still ahead count. Needs `claimedBy` and `POST`. |
| `rank` | no | `{ "orderBy", "where"? }`: a create also answers where the new row stands, as the number of rows ordered by `orderBy` at or before it. `where` is `{ "column", "eq" }`. Needs `POST`. |
| `humanCheck` | no | `true`: the browser solves a small proof of work before a create or a claim is taken. Only on an entry that creates or claims. |
| `anonymous` | no | Limits on a create nobody signed in for. See [Limits on a stranger's create](#limits-on-a-strangers-create). |
| `requireSetting` | no | Up to 4 `{ "table", "column", "when"? }`, each a bool of the settings table. While one is false, every write through the entry is refused. |
| `confirm` | no | An email Adminium sends when a guest creates a row; needs `POST`. See below. |

`writableValues` and `writableWhen` pin both ends of a change: `status` may become `cancelled`,
and only while it is `booked`. `writableWhen` is part of the change itself, never of a read, so a
finished visit still lists but cannot be moved; a change to a row in any other state answers as if
the row were not there. An entry with `claimedBy` that changes an enum column must list its
`writableValues`: permission to cancel is not permission to mark a visit seen.

A window lets a change wait for its time: `"starts_at": { "within": 60 }` takes a check-in up to an
hour before the visit, or any time after it. A change asked for earlier is refused `409`
`PUBLIC_TOO_EARLY`, and the reply's `params` carry `at`, the row's time, and `from`, when the window
opens, both as instants — even when `select` leaves the column out; naming the window agrees to
that. The refusal is said only for a row the caller's own read reaches, with every other state in
`writableWhen` met; any other miss answers as if the row were not there.

`confirm` takes `template` (only `booking-confirmation` today), `to` (the column holding the
guest's address) and optionally `code`, `when`, `party` and `name` (columns the email shows),
`venue` (`{ "table", "name"?, "address"?, "phone"? }`, the app's one-row venue table) and `link`
(a path under the customer side, up to 200 characters).

An `availability` entry answers free or full and never returns a row. It is `GET` only, and the
table must declare a [`capacity`](#capacity) or a [`booking`](#booking). On a capacity table it
answers each slot of a day for a party size. On a booking table it answers the times of a day, or
a strip of up to 31 days, for a kind and optionally a person; a guest is offered only people
bookable online, and is never told who.

The install's check step lists every endpoint it will create, and warns about anything that would
stop the key working, such as the public API being off or no time zone set on the database.

### Filters

A filter limits every read and every write of the entry.

| Filter | Rows it keeps |
|---|---|
| `{ "column", "op", "value" }` | `op` is `eq`, `neq`, `in`, `gte` or `lte`. |
| `{ "column", "op": "today" }` | Rows whose date or time falls on today. |
| `{ "column", "op": "from-today", "days"? }` | Rows from today onwards; `days` (1–366) limits how far, today included. |

`today` and `from-today` need a `date` or `timestamptz` column, and are worked out on every
request in the venue's time zone. A filtered column can be `writable` only when both
`writableWhen` and `writableValues` pin it; otherwise a write could move the row out of the
endpoint half-way.

### A person's own rows

An entry with `claim` is its key's **identity**. A caller proves they know a row's details (a
mobile number and a date of birth) and gets a session on that row. Each key has at most one
identity.

| Field | Rule |
|---|---|
| `match` | 1–3 columns the caller must match. |
| `verify` | `"email-code"`: the session starts at `lookup`, and a code emailed to the row's own address raises it to `verified`. |
| `email` | With `verify` only: the `text` column holding the address. |

An entry with `claimedBy` reaches only the claimed person's rows. `table` is the table its key's
identity claims. `column` is a foreign key of this entry's table pointing at it, or that table's
own primary key when the entry is on the identity's table. The column is filled from the session,
so it cannot be `writable`. With `optional: true`, a create goes through with no session at all:
a first visit by someone not yet on file. Only an entry whose `methods` is exactly `["POST"]` may
be optional. An identity takes no `claimedBy`.

```json
"publicAccess": [
  { "table": "patients", "methods": ["GET"], "select": ["name"],
    "claim": { "match": ["mobile", "date_of_birth"], "verify": "email-code", "email": "email" },
    "sensitive": true, "humanCheck": true },
  { "table": "appointments", "methods": ["GET", "PATCH"],
    "claimedBy": { "table": "patients", "column": "patient_id" }, "level": "verified",
    "sensitive": false, "reason": "Times and visit types only, no clinical notes.",
    "select": ["id", "starts_at", "visit_type_id", "clinician_id", "status"],
    "writable": ["status"], "writableValues": { "status": ["cancelled"] },
    "writableWhen": { "status": ["booked"], "starts_at": "from-now" } },
  { "table": "appointments", "methods": ["POST"],
    "claimedBy": { "table": "patients", "column": "patient_id", "optional": true },
    "sensitive": false, "reason": "A new booking answers with its own time only.",
    "select": ["id", "starts_at"],
    "writable": ["starts_at", "visit_type_id", "clinician_id", "new_name", "new_mobile", "new_email"],
    "defaults": { "status": "booked" },
    "humanCheck": true,
    "maxOpen": { "column": "status", "values": ["booked"], "n": 2, "upcoming": "starts_at" },
    "onClaim": { "clear": ["new_name", "new_mobile", "new_email"] },
    "anonymous": { "perValue": { "columns": ["new_mobile", "new_email"], "n": 2 },
                   "perKeyHour": 30, "plainText": ["new_name"] },
    "requireSetting": [{ "table": "settings", "column": "online_booking" },
                       { "table": "settings", "column": "new_patients_online", "when": "anonymous" }] }
]
```

The rules that tie these together:

- **Levels.** An entry with `level: "verified"` refuses a `lookup` session with
  `PUBLIC_CLAIM_LEVEL`, and needs an identity that sends a code. A code is six digits, lasts
  10 minutes and allows 5 tries; a verified session lasts 30 minutes. See
  [The emailed code](/guides/apps/public-access/#the-emailed-code).
- **Sensitive rows.** An identity marked `sensitive: true` shows a `lookup` session only its own
  `select`, and must send a code. Every `claimedBy` entry of its key must then say `sensitive`
  either way: `true` needs `level: "verified"`, and `false` needs a `reason`.
- **The address.** Where a claim sends a code, no entry may write the identity's `email` or `match`
  columns or create rows on its table: a session could otherwise send the next code to itself.
  The install refuses such an endpoint.
- **The human check.** A `claimedBy` entry with `humanCheck` needs an identity with `humanCheck`
  too, or claiming first would skip the proof. A found person's own create on an entry with
  `maxOpen` asks no proof. See [The human check](/guides/apps/public-access/#the-human-check).
- **`maxOpen`** counts only for a signed-in create, and refuses the next one with
  `PUBLIC_LIMIT_REACHED`.

For the whole flow, see [A person's own rows](/guides/apps/public-access/#a-persons-own-rows).

### Limits on a stranger's create

`anonymous` limits a create that nobody signed in for: an entry with no claim at all, or an
optional `claimedBy` create made with no session. It needs `POST`.

| Field | Rule |
|---|---|
| `perValue` | `{ "columns", "n" }`: at most `n` (1–20) creates a day for one phone number or address in any of these `text` columns (1–4), through any key or page. A phone number counts by its last nine digits, and an address in lower case, so two spellings of one number are one number. |
| `perKeyHour` | At most this many (1–1000) such creates an hour through the key, from everyone. |
| `plainText` | 1–8 `text` columns that hold plain text only: letters, spaces and ordinary punctuation, up to 80 characters, with no digits and no link. |

A create over a limit is refused with `PUBLIC_LIMIT_REACHED`, and one that breaks `plainText` with
`PUBLIC_WRITE_REFUSED`. A create refused for another reason (the slot was taken) does not count.
See [Limits on a stranger's create](/guides/apps/public-access/#limits-on-a-strangers-create).

`requireSetting` switches an entry off from the settings row: while one of its bools is false,
writes through the entry are refused with `PUBLIC_SWITCHED_OFF`. With `"when": "anonymous"`, the
switch holds only for a create with no session, so a found patient can still book while new
patients are turned away; it is allowed only on an optional `claimedBy` entry. A switch is read
from the settings table and trusted for 15 seconds. No row, no column or a failed read counts as
off. See [Switches in the settings row](/guides/apps/public-access/#switches-in-the-settings-row).

### publicKeys

`publicKeys` declares browser keys besides `customer`, keyed by a kebab-case name of up to 32
characters. Such a key is never published on the customer side. The staff side is handed it, in
its `surface-config.json` under `publicKeys`, only when the person signed in holds the key's role.
Every request on the key must then carry that same staff sign-in, from the same origin, with the
CSRF token on a write. A token copied out of the page opens nothing on its own.

```json
"publicKeys": {
  "kiosk": { "requiresStaff": { "role": "kiosk" },
             "enabledBy": { "table": "settings", "column": "kiosk_on" } }
},
"roles": [
  { "key": "kiosk", "name": "Check-in tablet", "screensOnly": true, "permissions": ["app:@:staff"] }
],
"publicAccess": [
  { "table": "patients", "key": "kiosk", "methods": ["GET"], "select": ["name"],
    "claim": { "match": ["surname", "date_of_birth"] } },
  { "table": "appointments", "key": "kiosk", "methods": ["GET", "PATCH"],
    "claimedBy": { "table": "patients", "column": "patient_id" },
    "filters": [{ "column": "starts_at", "op": "today" }],
    "select": ["id", "starts_at", "status"],
    "writable": ["status"], "writableValues": { "status": ["checked_in"] },
    "writableWhen": { "status": ["booked"], "starts_at": { "within": 60 } } }
]
```

| Field | Required | Rule |
|---|---|---|
| `requiresStaff` | yes | `{ "role" }`: one of the app's roles. It must be `screensOnly`, with no `cloneFrom` and no grant but `app:@:staff`, because the screen stands where anyone can walk up to it. |
| `enabledBy` | no | `{ "table", "column" }`: a bool of the settings table. While it is false the key answers `PUBLIC_KEY_OFF`. Read as `requireSetting` is, and trusted for 15 seconds. |

`customer` cannot be declared here, and at least one entry must name each key. A request without
the right staff sign-in is refused with `PUBLIC_STAFF_REQUIRED`; a super-admin is refused too.
Claims through a staff-bound key ask no proof, and their sessions last 3 minutes. See
[A kiosk](/guides/apps/public-access/#a-kiosk).

## Sample data

`sampleData` points at a file of demo rows inside the package:

```json
"sampleData": { "file": "seeds/visits.sample.json" }
```

The file must be in `seeds/` and end in `.json`. After installing, the operator can add the sample
data in one step and later remove it. Removal shows a preview first. It keeps every sample row the
operator's own records still point at and, if they choose, the rows they have changed since.

The file uses the `adminium.sample/1` format:

```json
{
  "format": "adminium.sample/1",
  "app": "visits",
  "tables": [
    { "ref": "clients", "rows": [{ "@label": "ada", "name": "Ada Byrne" }] },
    { "ref": "visits", "rows": [
      { "client_id": { "@ref": "ada" }, "starts_at": { "@day": 1, "@time": "09:30" },
        "note": { "@t": { "en-US": "First visit", "de-DE": "Erster Besuch" } } }
    ] }
  ]
}
```

| Field | Rule |
|---|---|
| `format` | Always `"adminium.sample/1"`. |
| `app` | The app's `key`. |
| `tables` | At least one `{ "ref", "rows" }`, each with 1–5000 rows, written in the order listed (parents first) and removed in reverse. Every `ref` and column must be declared in `requiredSchema`. |
| `assets` | Optional files for `@asset`: an object from a label to `{ "file": "seeds/…", "sha256": "<64 hex>" }`. |

A row may carry an `@label` (letters, digits and `: . _ -`, unique in the file) so a later row can
point at it. A value is plain JSON, or one of these directives:

| Directive | Value |
|---|---|
| `{ "@ref": "<label>" }` | The key of an earlier row with that label. |
| `{ "@ago": "PT19M" }` | An ISO 8601 duration before now. |
| `{ "@day": -1, "@time": "09:30" }` | A wall time in the venue's time zone, a number of days from today (−366 to 366). |
| `{ "@day": 3 }` | A date: that many days from today, as the venue's calendar has it. For a `date` column. |
| `"@workdays": true` | Added to either `@day` form: the days count Monday to Friday only, and day 0 on a weekend is the Monday after. So the sample's busy day is never a Saturday. |
| `{"@month": -2, "@dom": 14}` | A date in the venue's time zone: that day of the month, so many months back (`0` is this month). Add `"@time": "10:00"` for a time on that day. A day past the month's end is its last day, and a day that has not come yet is today (a time not yet come, now). Use it for history counted in calendar months: "this month" and "in May" read the same whether the sample is added on the 3rd or the 28th. |
| `{ "@t": { "en-US": "…" } }` | Text in the language of the person adding the sample. Keys are `xx` or `xx-XX`. |
| `{ "@asset": "<label>" }` | A file from `assets`, added to the Files library. |

Beside its `@label`, a row may carry one row directive, `@byClock`, so that a sample day's
statuses match the time it is added at:

```json
{ "@label": "visit-2", "starts_at": { "@day": 0, "@time": "10:00", "@workdays": true },
  "status": "booked",
  "@byClock": { "at": "starts_at",
                "before": { "status": "seen" },
                "around": { "status": "checked_in" } } }
```

| Field | Rule |
|---|---|
| `at` | The row's time: the name of a column the row sets, or a `@day` with a `@time`. |
| `before` | Columns merged into the row when its time is more than half an hour before the moment the sample is added. |
| `around` | Columns merged when its time is within half an hour of it. |
| `after` | Columns merged when its time is later. |

Each set holds columns of the table, and may use directives. A set with `"@skip": true` leaves the
row out altogether: a payment for a visit that has not happened yet. A later `@ref` to a row left
out fails. Every table that keeps totals is settled once all the sample rows are in, so a sample
visit's balance is right from the start. The totals so far are also settled before each table's
rows go in, so a row that copies a total from an earlier table (a stage invoice copying its quote's
subtotal) reads it worked out.

A row may also carry `"@onlyIfEmpty": true`, for a table that holds one row, such as the app's own
settings. The row is added only when the table is empty. When the operator already has a row there,
the sample leaves theirs alone, and a `@ref` to the sample row's label points at theirs.

A number Adminium gives without gaps (`sequence.gapless`) must be `null` in every sample row, so
the sample never takes numbers from the real series. Give sample rows their own spelling in the
formatted column instead, such as `INV-S2041`.

Adminium keeps track of the rows it added in a ledger table named `<key>_sample_data` (with `-` in
the key written as `_`), so avoid a table of that name.

## seeds and widgets

`seeds` (a list of `{ "table", "rows" }` or `{ "table", "file" }`, exactly one of the two) and
`widgets` (a list of `{ "id", "entry" }`) are accepted by the schema, but this release does not act
on them. Use [`sampleData`](#sample-data) for demo rows.

## Add-on manifests

An add-on manifest has `"kind": "add-on"` and shares the identity fields, `compatibility`,
`capabilities`, `settings`, `widgets` and `requiredSchema` with an app. It differs in these ways:

- **Categories** come from a separate list: `artwork`, `delivery`, `payments`, `email`, `data`.
- **No `pages`, `roles`, `frontends`**, and none of `navGroups`, `optionLists`, `publicAccess`,
  `publicKeys`, `outbox`, `emailTemplates`, `sampleData` or `seeds`. An add-on's own screens are
  code it ships, declared under `addOn.pages`.
- **`requiredSchema` is optional** and cannot be `prefixed`: an add-on uses its host app's
  tables. Tables an add-on creates are kept when it is disconnected.
- **An `addOn` block** is required:

| Field | Required | Rule |
|---|---|---|
| `attaches` | yes | At least one `{ "app", "range"?, "table"? }`: an app key, or `"*"` when the add-on is not specific to one app. `range` is `1.2.3`, `^1.2.3`, `~1.2.3` or `*`. `table` is only for the record editor panel slot. |
| `connect` | yes | `{ "kind" }`, with `kind` one of `none`, `api-key`, `oauth2`. `oauth2` needs `authorizeUrl`, `tokenUrl` and the `oauth-connect` capability; `scopes` is optional. |
| `provides` | no | Contracts the add-on implements: `{ "contract", "version", "server" }`. |
| `consumes` | no | Contracts it uses: `{ "contract", "version" }`. |
| `slots` | no | Places in the host's screens it fills: `{ "slot", "client", "order" }`. |
| `events` | no | Events it handles: `{ "on", "server" }`. |
| `scopes` | no | What it may reach, such as `records:<table>:write`. A `records:` scope must name a table of the host app or of the add-on. |
| `network` | no | `{ "allow": [hostnames] }`: the exact HTTPS hosts its server code may call. Required, and non-empty, with the `outbound-http` capability. No wildcards, IP addresses or ports. |
| `publicSettings` | no | The setting keys its browser code may read. Never a `secret` setting. |
| `demoTransport` | no | The module that stands in for the real third-party service in a demo. |
| `pages` | no | Dashboard pages it renders from its own bundle: `{ "ref", "title", "icon", "client", "nav"?, "detail"? }`, served at `/add-ons/<key>/<ref>`. Needs `hostApi`. |
| `navGroups` | no | Sidebar groups for those pages: `{ "key", "label", "order" }`. A group may not reuse a built-in key (`workspace`, `library`, `planning`, `people`, `account`), and every declared group must be used by a page. |
| `hostApi` | with `pages` | The version of the host API its pages are built against: `1`. |

Contract ids and slot ids come from closed registries in the add-on contracts package. How
Adminium runs add-on code, and why only first-party add-ons are accepted, is explained in
[Add-on trust](/anatomy/decisions/add-on-trust/).

## Validation

Adminium validates a manifest when a package is uploaded or downloaded from the catalogue, and
refuses an invalid one before anything is written. The refusal lists every problem,
each with the path of the field (`requiredSchema.tables.0.columns.2.default`) and a message. The
checks are:

- **The schema.** Every field on this page, its type and its limits. Every object is strict, so a
  misspelled or unknown field is an error.
- **Cross-references.** Every name the manifest uses must be declared in it, and be of the right
  type: a rule's columns, a capacity's or a booking's tables and columns, a public entry's table
  and columns, a public key's role, the outbox's columns and templates, an option list, a foreign
  key's target. A `PATCH` without a claim, a writable column that Adminium decides, and an
  `availability` entry on a table with neither `capacity` nor `booking` are refused, along with
  every rule stated in the sections above.
- **Policy.** The publisher must be `adminium`, and the key must not be reserved.
- **The version floor.** An app or add-on whose `minAdminiumVersion` is newer than the server is
  refused with a message naming both versions, including when an older server cannot parse a
  newer manifest.
- **The install plan**, against the operator's database: name lengths for that database (63 bytes
  on Postgres and SQLite, 64 on MySQL, including foreign key names `fk_<table>_<column>`), role
  names, page forms, email template blocks, public endpoints, and tables that are taken.

There is no published JSON Schema file for manifests. The schema itself is published as the
`@adminiumjs/manifest` npm package. Its `validateManifest(document)` runs the schema,
cross-reference and policy checks and returns every issue, so an app's own CI can refuse a bad
manifest before it is released.
