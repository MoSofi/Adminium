---
title: Manifest spec
description: The manifest.json every app and add-on package carries — identity, tables, column rules, formulas, states, bookings, pages, frontends, roles, settings, add-ons, documents, emails, public access and sample data, field by field.
---

A **manifest** is the `manifest.json` at the root of an app or add-on package. It tells Adminium
what the package is, which tables it needs in the operator's database, and what it adds on top of
them: pages in the sidebar, roles, settings, frontends, the add-ons it needs, documents, emails,
public endpoints and sample data. Adminium validates it before anything is installed, and builds
the install plan from it.

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
| `builtOn` | no | `<add-on key>/<shape name>@<version>`, such as `invoices/invoice@1`: the table is built on a shape an add-on defines. Needs `part`. See [Tables built on an add-on's shape](#tables-built-on-an-add-ons-shape). A table has `shape` or `builtOn`, not both. |
| `part` | with `builtOn` | snake_case: which part of the shape the table is (`document`, `lines`, `payments`). Only a table with `builtOn` has one. |
| `capacity` | no | A limit on how much of a time slot the table's rows may take; see [Capacity](#capacity). |
| `booking` | no | Rows that book a person's time, never overlapping; see [Booking](#booking). A table has `capacity` or `booking`, not both. |
| `states` | no | The states a row moves through, what is locked in each, and the child tables tied to them; see [States](#states). |

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
| `scale` | no | `decimal` and `money` only: the places kept after the point. See [Decimal places](#decimal-places). |
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

A value that comes from somewhere else when the row is made (the connection's currency, a
setting) is not a database default: use the [`default` rule](#column-rules).

#### Decimal places

`scale` says how many places a `decimal` or `money` column keeps after the point:

| Value | Places |
|---|---|
| `0`–`4` | That many. |
| `"currency"` | The decimals of the row's own currency: 0 for JPY, 2 for EUR, 3 for KWD. The currency is read from the table's own column named `currency` when the table has one and the row fills it, else from the connection's currency, else 2 places. A value that is not a currency code Adminium knows counts as 2 places. |

```json
{ "ref": "total", "type": "decimal", "scale": "currency", "nullable": true }
```

Every value a write sends to the column is rounded to its scale, half away from zero, without ever
passing through a floating-point number. [Rollup](#totals-and-balances) totals and
[formulas](#formulas) round to it too. With `"currency"`, a document keeps the places of the
currency it was written in, even after the connection's currency changes. A decimal with no
`scale` is made with four places.

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
| `default` | `{ "from" }` | A value filled on a create that leaves the column empty, read when the row is made. See [Values from elsewhere](#values-from-elsewhere). |
| `sequence` | `{ "start"?, "gapless"?, "startSetting"?, "scope"? }` | The next number in a running series. Without `gapless`, the column's own counter; `start` is at least 1. With `"gapless": true`, a number with no gaps and none repeated. See [Numbers without gaps](#numbers-without-gaps). |
| `format` | `{ "from", "prefix"?, "prefixSetting"?, "pad"? }` | A `text` column written from a gapless number of the same row: the prefix, then the digits padded with zeros (`INV-0042`). See [Numbers without gaps](#numbers-without-gaps). |
| `code` | `{ "length", "prefix"? }` | A short random code, unique in the column. `length` is 4–16; `prefix` is upper case, up to 6 characters plus an optional `-` (`MR-`). |
| `formula` | an expression | A number worked out from the row's other columns on every write. See [Formulas](#formulas). |
| `normalize` | `"trim"` or `"email"` | How a `text` value is kept: `trim` without spaces at either end, `email` trimmed and in lower case. |
| `notAfter` | `"today"` | A `date` column is never later than today, in the venue's time zone. A later date is refused (`out-of-range`). |
| `notBefore` | `{ "column", "via"? }` | A `date` column is never earlier than another date column: of the same row, or, with `via`, of the row its foreign key `via` points at (a payment never before its invoice's `issued_on`). |
| `rollup` | `{ "from", "via", "sum", "times"?, "unlessSet"?, "where"?, "balance"?, "cap"? }` | A total over child rows, kept up to date as they change. `from` is the child table, `via` its foreign key back to this table, `sum` the column to add up. `times` multiplies each row (a quantity); a child row with a value in `unlessSet` is left out (a voided line). See [Totals and balances](#totals-and-balances) for `where`, `balance` and `cap`. |
| `stamp` | `{ "set", "on" }` | A value Adminium writes when something happens: the moment, or who did it. See [Stamps](#stamps). |
| `venueLocal` | `true` | A wall time given with no zone is read in the venue's time zone. |
| `personal` | `true` or `false` | Whether the column is personal data, overriding the guess Adminium makes from the column's name. |

Tones are the dashboard's badge colours: `neutral`, `accent`, `info`, `pos`, `warn` and `danger`.

`copy`, `default`, `sequence`, `format`, `code`, `rollup`, `formula` and `stamp` are values
**Adminium decides**: they are filled on the server, so a browser never picks a price, a number, a
code or a time. So are a rollup's `balance` column and a booking's late-cancellation
[`flag`](#booking). None of them can be listed as `writable` in [public access](#public-access), and
a primary key cannot take `sequence` or `code`.

One rule decides a column. The one pair allowed is a `copy` with a `default` behind it: the copy
comes first, and the default fills the column when the copy comes back empty (a client's own tax
rate, else the business's). A stamped column takes none of the others.

Every name a rule uses is checked against the manifest: `copy.via` must be a foreign key of the
table, `rollup.via` must point back at this table, and so on. `normalize` is for `text` columns
only.

The rules are kept on every door a row is written through: a form, a bulk edit, an import, an
automation, the public API and an outbox's `onSent` change. `normalize`, `formula` and the
rounding to a `scale` apply on each of them. History keeps what it brings: an import and sample
data are not [stamped](#stamps), not [capped](#totals-and-balances), and not held to `notAfter` or
`notBefore`; an undo puts a row back exactly as it was, with no rule at all. A date refused by
`notAfter` or `notBefore` answers `422` `VALIDATION_FAILED`, the field's code `out-of-range`.
`notBefore` is judged when the date is written, and when its `via` link changes.

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

#### Formulas

A `formula` works a number out from the other columns of the same row: a line's amount, a
document's tax and total.

```json
{ "ref": "amount", "type": "decimal", "scale": "currency", "nullable": true,
  "rules": { "formula": { "max": [0, { "sub": [{ "mul": ["qty", "rate"] }, { "coalesce": ["discount", 0] }] }] } } }
```

An expression is a number, a column of the same row by its ref (`"qty"`), or one of these objects:

| Expression | Value |
|---|---|
| `{ "add": [a, b, …] }` | The sum of 2–8 expressions. |
| `{ "sub": [a, b] }` | `a − b`. |
| `{ "mul": [a, b, …] }` | The product of 2–8 expressions. |
| `{ "div": [a, b] }` | `a ÷ b`. Empty when `b` is zero. |
| `{ "min": [a, b, …] }`, `{ "max": [a, b, …] }` | The smallest or largest of 2–8 expressions. |
| `{ "round": a }` or `{ "round": [a, places] }` | `a` rounded half away from zero, to the column's scale or to `places` (0–4). |
| `{ "coalesce": [a, b] }` | `a`, or `b` when `a` is empty. |
| `{ "if": [condition, a, b] }` | `a` when the condition holds, else `b`. |

A condition is one of:

| Condition | Holds when |
|---|---|
| `{ "eq": [column, value] }`, `{ "neq": [column, value] }` | The column equals, or does not equal, a string, number or boolean. The column may be of any type (an enum, a bool). `neq` does not hold for an empty column. |
| `{ "gt": [a, b] }`, `{ "gte": … }`, `{ "lt": … }`, `{ "lte": … }` | `a` is greater, greater or equal, less, or less or equal than `b`. A comparison with an empty side does not hold. |
| `{ "isNull": column }` | The column is empty. |
| `{ "and": [c, c, …] }`, `{ "or": [c, c, …] }` | All, or any, of 2–8 conditions. |

```json
{ "if": [{ "eq": ["discount_kind", "percent"] },
         { "mul": ["qty", "rate", { "sub": [1, { "div": [{ "coalesce": ["discount", 0] }, 100] }] }] },
         { "sub": [{ "mul": ["qty", "rate"] }, { "coalesce": ["discount", 0] }] }] }
```

How a formula is worked out:

- **Exactly.** Every value is read from its decimal text as an exact fraction, and nothing goes
  through a floating-point number. `1 ÷ 3 × 3` is exactly 1, and a total is the same on Postgres,
  MySQL and SQLite to the last minor unit.
- **Rounded once**, half away from zero, to the column's [scale](#decimal-places). A formula
  column with no `scale` rounds to 0 places when it is an `int` or `bigint`, and to 4 when it is a
  decimal. `round` inside a formula rounds that part early, where the arithmetic calls for it (a
  tax rounded before it is added).
- **Empty in, empty out.** An empty column makes the result empty unless `coalesce` says what to
  read instead: a draft line with no rate yet has no amount, rather than an amount of 0 that looks
  like a price.
- **On every write.** A create works out every formula; an update works out the ones whose inputs
  it changed, reading the stored row with the new values over it. A formula that reads another
  formula column is worked out after it. A formula that reads a [rollup](#totals-and-balances)
  total is worked out again whenever the total moves.

A formula fills a `decimal`, `money`, `int` or `bigint` column, never a `float`. It reads only
columns of its own table, and every column it counts with holds a number; `eq`, `neq` and
`isNull` may name any column. It may not read itself, formulas may not read each other in a
circle, and an expression nests at most 8 deep. A value a writer sends to a formula column is
dropped. Anything that reads another row is a `copy` or a `rollup`, which already keep in step
when that other row changes.

#### Numbers without gaps

A tax office expects an unbroken series of invoice numbers: none twice, none skipped. A
`sequence` with `"gapless": true` numbers rows that way.

```json
{ "ref": "number_seq", "type": "int", "nullable": true,
  "rules": { "sequence": { "gapless": true,
                           "startSetting": { "addOn": "invoices", "setting": "number_start_invoice" } } } },
{ "ref": "number", "type": "text", "maxLength": 24, "nullable": true, "unique": true,
  "rules": { "format": { "from": "number_seq",
                         "prefixSetting": { "addOn": "invoices", "setting": "prefix_invoice" }, "pad": 4 } } }
```

| Field | Rule |
|---|---|
| `gapless` | `true`. The column is an `int` or `bigint`, and nullable. |
| `start` | The first number, at least 1. |
| `startSetting` | The first number, read from a [setting](#values-from-elsewhere) when the row is made. Not with `start`. |
| `scope` | A foreign key of the table: the series restarts for each row it points at (a deliverable's versions, v1, v2 …). |

`scope` and `startSetting` need `gapless`.

The number is the largest the table holds (for `scope`, the largest for that parent row) plus one,
and never less than the start. It is taken inside the transaction that inserts the row, so an
insert that fails takes its number back with it and the next create takes the same one. Two
creates at once never read the same largest number. When one is still taking the next number, the
other may be answered `409` `NUMBER_BUSY`, to try again. A number a writer sends is dropped, from
every writer but an import. A numbered row's create is never undone: undo is refused `409`, since a
number once taken stays taken; void the row instead.

`format` writes the number as text in the same statement:

| Field | Rule |
|---|---|
| `from` | The row's numbered column (one with a `gapless` sequence). |
| `prefix` | Up to 12 letters, digits and `- _ / .` (`INV-`). |
| `prefixSetting` | The prefix, read from a [setting](#values-from-elsewhere) when the row is made. Not with `prefix`. A change applies to the next number. |
| `pad` | The digits are padded with zeros to this many (0–12). |

The `format` column is `text` and nullable, and its `maxLength` must hold the prefix and the
padding. Give the text a `unique` constraint, as the example does: a second guard against a
number twice, which MySQL's numbering also leans on.

An import brings its own history: it keeps the numbers its rows carry, and a row that carries only
the text, written as the table's prefix followed by digits, gets the number from those digits.
The series then carries on after the largest. Sample rows spell a gapless number `null`, so they
stay off the real series; see [Sample data](#sample-data).

#### Values from elsewhere

A `default` rule fills a column on a create that leaves it empty, with a value read when the row is
made:

```json
{ "ref": "currency", "type": "text", "maxLength": 3, "nullable": true,
  "rules": { "default": { "from": "connection.currency" } } },
{ "ref": "tax_rate", "type": "decimal", "scale": 3, "nullable": true,
  "rules": { "default": { "from": { "addOn": "invoices", "setting": "default_tax_rate" } } } }
```

`from` is one of:

| `from` | Reads |
|---|---|
| `"connection.currency"` | The connection's currency, a three-letter code. The column is `text` of at least 3 characters. |
| `{ "table", "column" }` | A column of the app's one-row settings table. |
| `{ "addOn", "setting" }` | A setting of an add-on. The app must require that add-on in [`addOns.requires`](#add-ons), so the setting is always there. |

The same three settings (the last two) are what `sequence.startSetting` and `format.prefixSetting`
read. A column with a `default` rule is nullable: when there is nothing to read, it stays empty
rather than taking a made-up value. An update never refills it.

#### Stamps

A stamp writes a value when a row is created, or when another column changes to one of a list of
values: the time a patient checked in, who took a payment.

```json
{ "ref": "checked_in_at", "type": "timestamptz", "nullable": true,
  "rules": { "stamp": { "set": "now", "on": { "column": "status", "values": ["checked_in"] } } } }
```

| Field | Rule |
|---|---|
| `set` | What is written; see the table below. |
| `on` | When: `"create"`; `{ "column", "values" }`, another column of the table and 1–16 values it must change to; `{ "column", "filled": true }`, the moment another column, a nullable one, is first filled; or a list of 2–3 of these, any of which writes the stamp. |

What a stamp writes:

| `set` | Writes | Column |
|---|---|---|
| `"now"` | The moment. | `timestamptz` |
| `"today"` | Today's date on the venue's calendar. | `date` |
| `"user-name"`, `"user-id"` | Who made the write. | `text` |
| `{ "byOrigin": { "public", "staff"? } }` | One value for a write through the public API and another for everyone else. With no `staff`, a staff write keeps the value its writer chose (a desk records how a client approved; the portal always says "portal"). Each value must fit the column. | `text` or `enum` |
| `{ "copy": column }` | Another column of the same row, as it stands at that moment: a client's first answer, kept when they edit it later. Both columns have the same type. | any |
| `{ "claim": column, "staff"? }` | A column of the signed-in person's own row (their email, their name), on a public write. `column` is a column of a table the app's people sign in as (an entry with a [`claim`](#a-persons-own-rows)). `staff` is `"user-name"` or `"user-id"`: what a staff write stamps instead. | `text` |
| `{ "addDays": { "date", "days", "map"? } }` | A date so many days after `date`, a `date` or `timestamptz` column of the row: a due date from the issue date and the terms. `days` is a number (0–3650) or a column: an `int`, or an enum or text column with `map` giving each of its values its days. | `date` |
| `{ "hashOf": { "columns", "children"?, "linked"? } }` | A fingerprint: SHA-256 over the named columns, child rows and linked rows, in a canonical form anyone can recompute. | `text` of at least 64 characters |

`hashOf` takes 1–24 of the row's own `columns`; up to 4 `children`, each
`{ "table", "via", "columns", "orderBy"? }`, a child table whose foreign key `via` points at this
table, read in `orderBy` order and then by key; and up to 4 `linked`, each
`{ "via", "table", "columns", "children"? }`, the row this table's foreign key `via` points at, with
its own children.

```json
{ "ref": "due_on", "type": "date", "nullable": true,
  "rules": { "stamp": {
    "set": { "addDays": { "date": "issued_on", "days": "terms",
                          "map": { "net7": 7, "net14": 14, "net30": 30, "on-receipt": 0 } } },
    "on": { "column": "status", "values": ["sent"] } } } }
```

A change is judged against the stored row, so sending a status the row already holds stamps
nothing again. A create that already holds one of the values (a walk-in written as checked in)
is stamped too. A stamp wins over a value the writer sent. Between its moments a stamped column
is Adminium's, and a value a writer sends there is dropped, with two exceptions for staff: an
`addDays` date (the desk may still move a due date) and a `byOrigin` column with no `staff`
value. A `byOrigin` value that is itself `now`, `today`, `user-name` or `user-id` writes what that
stamp would.

A public write stamps like any other write, except `user-name` and `user-id`: a browser key is
nobody, so they write nothing. What it knows of the person is their own signed-in row, which is
what `claim` reads. For an automation, `user-name` is the rule's name. Imports, sample data and
undo stamp nothing, since a stamp of today's time over history would be false; an import keeps
the stamped values it brings. A stamped column takes
no `copy`, `default`, `sequence`, `format`, `code`, `rollup` or `formula` as well, and a stamp
watches a column other than its own.

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

### States

`states` describes the life of a row: the states it moves through, what may happen in each, and
the child tables tied to them. An invoice is a draft, then sent, then perhaps void; once sent, its
lines are locked and payments may be recorded against it.

```json
"states": {
  "column": "status", "initial": "draft",
  "moves": {
    "draft": [{ "to": "sent", "requires": { "children": { "invoice_lines": 1 },
                                            "where": [{ "column": "total", "gt": 0 }] } }, "void"],
    "sent":  [{ "to": "void", "requires": { "where": [{ "column": "paid", "eq": 0 }] },
                "roles": ["manager"] }]
  },
  "lock": { "when": ["sent", "void"], "except": ["due_on", "ladder", "void_reason"] },
  "children": {
    "invoice_lines": { "via": "document_id", "lock": true },
    "payments": { "via": "document_id", "parentIn": ["sent"], "clearOnCreate": ["client_paid_at"] }
  },
  "noDelete": { "when": "numbered" }
}
```

| Field | Required | Rule |
|---|---|---|
| `column` | yes | The `enum` column that holds the state. Every state named below is one of its values. |
| `initial` | yes | The state a new row starts in. |
| `moves` | yes | From each state, up to 16 states a row may move to. A move is a state (`"void"`), or `{ "to", "requires"?, "roles"? }`. A move goes to another state. |
| `lock` | no | `{ "when", "except"? }`. While a row is in one of `when` (1–16 states), only the columns in `except` (up to 32) may change, and the state itself through a move. The state column is never in `except`. |
| `children` | no | Child tables tied to the row's state, keyed by table ref. See below. |
| `lockedWhenReferencedBy` | no | 1–4 `{ "table", "via", "in" }`: the row is locked once a row of `table`, whose foreign key `via` points at it, is in one of the states `in` (a terms version, once a proposal naming it is sent). Needs `lock`, which says what stays open. |
| `noDelete` | no | `{ "when" }`: rows that are never deleted, only voided. `when` is 1–16 states, or `"numbered"`: any row that holds a number from a [gapless sequence](#numbers-without-gaps). `"numbered"` needs such a column on the table. |
| `onlyLater` | no | 1–8 `date` or `timestamptz` columns that may move later, never earlier (a quote's `valid_until`). |

A move's `requires` says what must be true first:

| Field | Rule |
|---|---|
| `children` | `{ "<table>": n }`: at least `n` (1–1000) rows of a child table. The table must be one of `children`. |
| `where` | 1–8 conditions on the row itself: `{ "column", <one test> }`, where the test is `eq` or `in` (values that fit the column), `isNull` (`true` or `false`), or `gt`, `gte`, `lt` or `lte` (a number, on a number column). |

A move's `roles` (1–8 of the app's [role](#roles) keys) keeps it for the people holding one of
them: any role may void a draft, only a manager a sent invoice.

Each entry of `children` names a child table whose foreign key `via` points at this table, with at
least one of:

| Field | Rule |
|---|---|
| `lock` | `true`: the child's rows are locked while this row is. Needs a `lock` on this table. |
| `parentIn` | 1–16 states: the child's rows may be written only while this row is in one of them (payments on a sent invoice). Not with `lock`. |
| `clearOnCreate` | 1–8 nullable columns of **this** row, emptied when a child row is created (a recorded payment clears the client's "I've sent it"). |

A move that is not listed is not one the row may make. Columns Adminium keeps (totals, balances,
formulas, stamps) are Adminium's to write whatever the state. A new row starts in `initial`. A
locked row cannot be deleted either, with or without `noDelete`.

The states hold on every write to the table: a form, a bulk edit, an automation, the public API,
and an outbox's `onSent` change. A refusal is `409`: `STATE_MOVE_REFUSED` for a move the row may
not make (or a new row that does not start in `initial`), `RECORD_LOCKED` for a change to a locked
row or to a child row its parent's state does not allow, and `DELETE_REFUSED` for a delete. An
`onlyLater` column moved earlier, or emptied, is refused `422` with the code `out-of-range`.
Through the public API each of these is `PUBLIC_WRITE_REFUSED`.

Adding sample data and importing past records are history. A new row they write may start in
any state, and a child row may follow a parent the same import or sample brought in; a child
row under a parent that was already there is judged as any other write. An import that updates
a row already there is judged in full, and a history write empties no `clearOnCreate` column.
An undo is never given for a write to a table with states, or to its child tables: a mistake is
moved on (voided, sent back), never unwritten.

### Tables built on an add-on's shape

An add-on can define a **shape**: a set of named parts, each with its columns, the rules Adminium
keeps on them and its states. The Invoices & Receipts add-on defines `invoice@1`, whose parts are a
`document`, its `lines` and its `payments`. An app builds its own tables on it:

```json
{ "ref": "invoices", "builtOn": "invoices/invoice@1", "part": "document",
  "columns": [ … every column of the part, then the app's own … ],
  "states": { … the part's states … } }
```

`builtOn` is `<add-on key>/<shape name>@<version>`. The app must require that add-on in
[`addOns.requires`](#add-ons). `builtOn` is not the table's [`shape`](#tables) field: that lets two
apps share one table, while two apps built on one add-on's shape each get tables of their own.

The table **spells out** every column of its part, with the part's type, nullability, enum values,
`maxLength`, `scale`, `unique`, `default` and rules, and the part's `states`. So every check of the
app reads its own manifest alone. Where a part's column refers to another part (`"references":
"document"`), the app's column refers to its own table built on that part (`"references":
"invoices"`), and a rule that names a part (a rollup's `from: "lines"`) names the app's table
instead.

What the app may add to a part, and nothing else:

- columns of its own, with any rules;
- a label, and the rules that label or narrow a part's column: `enumLabels`, `personal`,
  `validation`, `required`, `options`, `notAfter` and `notBefore`;
- a `copy` in front of a column the part fills with a `default` (a client's own tax rate before the
  add-on's default rate): the part's default still answers when the copy comes back empty;
- in the states: more `lock.except` columns (its own columns that stay writable), `roles` on a
  move, more tables in `children`, and more columns in a child's `clearOnCreate`.

Everything else, from a column's type to a rule that decides a value or a move, is the part's own.

The install checks each table against the shape of the add-on it will really run on: the installed
add-on, or the version the install brings with the app. A column dropped or retyped, or a rule
changed, refuses the install or update `409` `SHAPE_MISMATCH`, naming the column, before anything
is written. The app pins the shape's version: `invoice@1` is checked against the add-on's
`invoice@1`, whatever else a newer add-on ships beside it. An add-on update that no longer has a
shape version an installed app is built on is refused `409` `ADD_ON_SHAPE_IN_USE`; update the app
first. The tables themselves are the app's: two apps built on one shape get two sets of tables.

When the shape sends email, the app sends it too: its [`outbox`](#outbox) has a kind and a
producer for every kind the shape's outbox sends. The shape's document profiles (an invoice, a
receipt) are made for the app's tables when it is installed; see [Documents](#documents). For the
whole story, see [Building on an add-on](/guides/building-on-an-add-on/).

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
| `feature` | no | The id of one of the app's [`addOns.features`](#add-ons). Until every add-on the feature requires is installed, attached to the app and switched on there, the page leaves the sidebar and is listed apart, with the add-ons it needs. |

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

**Links that open a list filtered.** A link in a layout (a metric card's `href`, the toolbar's
`link`) may open a records page on some of its rows: `/p/<page ref>?f.<column>=<op>:<value>`, with
one `f.` piece per column, up to 8. "Overdue" leads to
`/p/studio-invoices?f.status=eq:sent&f.due_on=before:today`, and the page shows a chip for each
piece.

| Piece | Rows it keeps |
|---|---|
| `eq:<v>`, `neq:<v>`, `in:<a,b>` | The value, not the value, or one of up to 50 values. |
| `gt:`, `gte:`, `lt:`, `lte:` | A number, or a day. |
| `before:<day>`, `after:<day>` | A date or time before or after that day. |
| `before:now`, `after:now` | A time before or after this moment. |
| `month:this`, `month:last` | A date or time in this or last month. |
| `set`, `unset` | Has a value, or has none. |

A day is `YYYY-MM-DD`, `today`, or a whole number of days from it: `today-30`, `today+7` (at most
3660 either way). Days are the venue's: on a time column a day is the whole day where the venue
is. `now` is for time columns only. The pieces are worked out on the server when the page opens,
so `today` is always the day it is read. A piece the column cannot take (an unknown column, a
personal column the reader may not see, `gt` on a yes/no, a value that is not a number) is left
out, and its chip says so; the page never fails.

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
| `addOn:<add-on key>:settings` | Edit that add-on's non-secret settings (the letterhead of an invoicing add-on). Only an add-on the app requires or suggests in [`addOns`](#add-ons). |

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

## Add-ons

`addOns` names the add-ons an app needs, the ones it works better with, and the features that stop
without one.

```json
"addOns": {
  "requires": [{ "key": "invoices", "range": ">=1.1.0",
                 "reason": { "en-US": "Invoices, quotes and receipts are made by this add-on." } }],
  "suggests": [{ "key": "holiday-calendars", "range": ">=1.1.0", "checked": true,
                 "reason": { "en-US": "Marks public holidays as days off." } }],
  "features": [{ "id": "capacity-holidays", "label": { "en-US": "Holidays in Capacity" },
                 "requires": ["holiday-calendars"] }]
}
```

| Field | Required | Rule |
|---|---|---|
| `requires` | no | 1–8 add-ons the app cannot run without: `{ "key", "range", "reason" }`. |
| `suggests` | no | 1–8 add-ons offered with the app: the same, plus `checked`, whether the offer starts ticked. |
| `features` | no | 1–16 `{ "id", "label", "requires" }`: a part of the app that works only with some add-ons. `id` is kebab-case, up to 40 characters; `requires` lists 1–4 add-on keys, each one the app requires or suggests. |

`key` is an add-on's key. `range` is a semver range over its version (`>=1.1.0`, `^1.1.0`), up to
120 characters. `reason` and `label` are keyed [labels](#conventions), with `en-US` among them. An
add-on is named once, in `requires` or in `suggests`, and never the app itself.

What each list does:

- **Required.** The install check shows each required add-on, where its version comes from and its
  own install plan. Installing the app installs, updates or connects every required add-on first,
  before the app's own tables, so a table [built on its shape](#tables-built-on-an-add-ons-shape)
  and a foreign key into its tables resolve. One that cannot be had, or is out of range and not
  ticked to update, refuses the install before anything is written. An add-on an installed app
  requires cannot be removed or switched off: that is refused `409` `ADD_ON_REQUIRED_BY`, naming
  the apps. Nor can it be updated to a version outside the app's `range`: that is refused `409`
  `ADD_ON_RANGE`, and the app is updated first.
- **Suggested.** Offered on the install check, ticked when `checked` says so. The operator may
  leave it out.
- **Features.** A [page](#pages) that names a feature in `feature` leaves the sidebar while the
  feature's add-ons are not all installed and switched on for the app. A
  [document](#documents) may name one too.

If a later step of the app's install fails, the add-ons it installed stay: another app may already
rely on them. Uninstalling the app keeps them too; only their link to the app goes, and the
uninstall preview lists them. Only a required add-on's settings may be read by the app's rules (see
[Values from elsewhere](#values-from-elsewhere)); a role may be given any named add-on's settings
(see [Roles](#roles)).

## Documents

`documents` lists document profiles the app ships for its own tables: which columns make a printed
invoice, receipt or statement, drawn by an add-on that renders documents. Up to 16.

```json
"documents": [{
  "kind": "receipt", "addOn": "invoices", "table": "sales",
  "name": { "en-US": "Till receipt" },
  "mapping": {
    "number": { "column": "number" },
    "customerName": { "via": "customer_id", "column": "name" },
    "lines": { "collection": { "table": "sale_lines", "via": "sale_id", "orderBy": "position",
                               "columns": { "description": "name", "qty": "qty", "amount": "amount" } } }
  }
}]
```

| Field | Required | Rule |
|---|---|---|
| `kind` | yes | kebab-case: the kind of document (`invoice`, `receipt`, `statement`). One of each kind per table. |
| `addOn` | yes | The add-on that draws it. The app requires or suggests it. |
| `table` | yes | The app's table a document is drawn for, one per row. |
| `name` | yes | A plain string or a keyed [label](#conventions). |
| `mapping` | yes | From each of the add-on's slots (letters, digits and `_`, starting with a letter) to where its value comes from. See below. |
| `statement` | no | Makes the document a statement. See below. |
| `feature` | no | One of the app's [`addOns.features`](#add-ons). |

The slots are the add-on's words (`number`, `issuedAt`, `items`): a shape's own profiles, in the
add-on's manifest, show the ones it draws. Each slot reads one of:

| Source | Reads |
|---|---|
| `{ "column" }` | A column of the row. |
| `{ "via", "column" }` | A column of the row a foreign key `via` of this table points at: the client's name on an invoice. |
| `{ "collection": { "table", "via", "orderBy"?, "columns" } }` | A list of child rows, whose foreign key `via` points at this table, in `orderBy` order. `columns` maps the add-on's names for a line's values to the child's columns. |

Some slots have a **default** in the add-on's outline, which fills the slot when nothing else
does: when it is not mapped, and when the column it is mapped to is empty on this row (a draft
with no issue date yet).

| Default | Fills the slot with |
|---|---|
| `now` | The moment the document is made; a date slot takes that day on the venue's clock. A document drawn again (after an edit, in another language) is the same document and keeps the day it was first made. |
| `connection` | The document's currency: the row's own `currency` column when it holds one, else the connection's. |
| `sequence` | The number the document prints. |
| `setting` | Nothing on the server: it is one of the add-on's own settings, which the add-on reads itself. A required slot with this default still needs a mapping. |

A required slot that nothing fills makes the document fail, naming the slot ("unmapped or empty").

A **statement** is drawn for one row (a client) over a period. It lists the documents and the
payments that point at that row, with a running balance, so it names two sources rather than one
list:

```json
"statement": {
  "documents": { "table": "invoices", "via": "client_id", "date": "issued_on", "amount": "total",
                 "number": "number", "where": { "column": "status", "in": ["sent", "void"] } },
  "payments":  { "table": "payments", "via": "client_id", "date": "paid_on", "amount": "amount",
                 "unless": "voided" }
}
```

Each source is `{ "table", "via", "date", "amount", "number"?, "where"?, "unless"? }`: a table whose
foreign key `via` points at the document's table, its date and amount columns, and optionally its
number. `where` is `{ "column", "in": [1–16 values] }`, only rows whose column holds one of them
(sent invoices, never drafts); a row whose `unless` column is set is left out (a voided payment).

The period is chosen when the statement is drawn, never as dates: `all` (the default), `year`
(from 1 January) or `12m` (the last twelve months). What came before the period is carried in as
the opening balance, and rows dated after today are left out. A statement is issued on the day it
is drawn, on the venue's clock: that fills its issue date (`issuedAt`) unless the profile maps a
column to it.

A profile is the app's. It is made with the real table names when the app is installed, changed in
place by an update so documents already issued keep pointing at it, and removed when the app is
uninstalled. A profile whose add-on is not installed is skipped, with a reason on the install
reply. An operator's own profile is never changed.

When a table is [built on an add-on's shape](#tables-built-on-an-add-ons-shape), the shape's own
profiles are made for it at install. An app entry of the same kind on that table does not make a
second profile: its slots are added to the shape's mapping (the app's slot wins on the same name,
so an invoice can print the client's address from the app's own `clients` table), and its `name`
replaces the shape's.

The app's staff screens ask for a document by the app's own names:
`POST /api/v1/apps/<key>/documents/render` with `{ "kind", "ref", "pk", "period"?, "locale"? }`,
where `ref` is the table's short ref and `pk` the row's key. The document is drawn now, or the one
already drawn is handed back while the row is unchanged, with `contentUrl` for its bytes and
`printUrl` for a copy to print. The caller must be signed in and able to read every table the
document reads, a statement's sources included. An app, kind, row or table they cannot reach is
the one `404`; an add-on that is detached, or a feature switched off, is `409` `FEATURE_OFF`; a
document that cannot be drawn (a required slot left empty) is `422` `DOCUMENT_NOT_DRAWN`.

A signed-in person reaches the documents of their own rows through a [public entry's
`documents`](#public-access).

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
| `columns` | yes | The outbox's columns. `kind` is an enum of the kinds. `status` is an enum holding at least `queued`, `sent`, `failed` and `skipped`, and `held` when a producer holds. `to` is `text`, the address. Optional: `language` (`text`), `due` (`timestamptz`, required by a `before` producer and by one with `hold` or `due`), `sentAt` (`timestamptz`) and `error` (`text`), and the columns of [held messages](#held-messages): `skipReason` (`text` or `enum`), `subjectOverride`, `bodyOverride`, `approvedBy` and `effectError` (`text`), and `effectAt` (`timestamptz`). |
| `links` | no | The outbox's foreign keys, by the name a template reads them under: `{ "appointment": "appointment_id" }` gives a template `appointment.*`. Names are snake_case. Every foreign key of the outbox table that the outbox names must be nullable: not every email is about one. |
| `recipient` | yes | Who the email goes to. See below. |
| `settings` | no | The app's one-row settings table: `{ "table", "enabled"?, "name"?, "phone"? }`. Templates read it as `practice.*`. `enabled` is a bool that pauses producers with `gate: "enabled"`. `name` is a `text` column the app's emails are signed with, the [emailed code](#public-access) included; without it, the workspace's name is used. `phone` is a `text` column: when it holds a number, the notice sent to a person's old address after a change of email tells them to ring it; without one, the notice says to contact you. |
| `pages` | no | `{ "manage"?, "booking"? }`: paths on the app's customer side (`/my-visits`) that a template's `manage_url` and `booking_url` lead to. Up to 120 characters. Default: the side's front page. |
| `kinds` | yes | Each value of the kind column, and the key of the template it is sent with. Every value must be one of the enum's, and every template one of `emailTemplates`. |
| `producers` | no | Up to 24 rules that queue rows by themselves. See below. |

**`recipient`** is `{ "via", "table", "email", "name"?, "language"?, "optIn"?, "fallback"? }`.
`via` is the outbox's foreign key to the person, `table` the person's table, and the rest are its
columns: `email`, `name` and `language` are `text`, and `optIn` is a bool the person sets (false
means nothing from a producer that asks `optIn`). `fallback` is `{ "via", "email", "name"?, "language"? }`: where the address
comes from when `via` is empty. Its `via` is another foreign key of the outbox, and its columns
belong to the table that key points at; a first visit by someone not yet on file carries their
details on the visit itself.

**Producers.** Each has a `kind` (a key of `kinds`) and a `link`, the outbox's foreign-key column
that points at the row the message is about and must be one of `links`. Optionally `gate` and
`optIn: true` (needs `recipient.optIn`: a person who opted out gets nothing). `gate: "enabled"`
pauses the producer while the settings row's `settings.enabled` bool is false;
`gate: { "setting": { "table", "column" } }` pauses it while that bool of the settings row is false,
so each notice can have its own switch. Then exactly one of:

| Producer | Shape | Queues a row |
|---|---|---|
| `onCreate` | `{ "table", "via"?, "where"? }` | When a row of the table is created. |
| `onChange` | `{ "table", "via"?, "column", "to", "where"? }` | When the column changes to `to`, a value or a list of 1–16 values. |
| `before` | `{ "table", "at", "lead", "where"? }` | A lead time before `at`, a `timestamptz` of the row: a reminder. |

With `via`, the source is a **child** row and the message is about the row its foreign key `via`
points at: a version posted to a deliverable makes a message linked to the deliverable, and
addressed through it. `link` then points at that parent's table.

A producer may also say:

| Field | Rule |
|---|---|
| `hold` | `true`: its rows are written `held` and sent only once a person approves one. See [Held messages](#held-messages). |
| `due` | `{ "date", "days", "at"? }`: when the message comes due, `days` after `date` (a `date` or `timestamptz` of the row it is about), at `at` (`"HH:MM"`, 09:00 by default) on the venue's clock. Not on a `before` producer, which is due by its lead. |
| `supersede` | A group name (kebab-case, up to 40 characters). When a message of the group comes due for a row, the earlier ones not yet sent are skipped as overtaken, so an invoice never has two reminders ready at once. Needs `due`. |
| `dropWhen` | 1–4 conditions on the row the message is about: `{ "column", <one test>, "reason" }`, the test being `eq`, `in`, `isNull`, `lte` or `gte`. While one holds, its waiting messages are skipped with the `reason`: `paid`, `void` or `no-longer-needed`. Only a message that waits (`hold`, or `due`) can be dropped. |
| `recipient` | `{ "setting" }`: send to the address a setting holds (a studio's own `reply_to`), never to the person the row links. The setting is `{ "table", "column" }` of the settings row, or `{ "addOn", "setting" }` of a required add-on. |
| `batchMinutes` | 1–240: one message per linked row in each window of this many minutes. The first event opens a message due at the window's end; every event while it still waits is taken in by it (five versions posted in ten minutes make one email). Not on a `before` producer. |
| `onSent` | `{ "table", "via"?, "set" }`: a change made once the message has gone. Without `via`, `table` is the row the message is about; with it, `via` is that row's foreign key to `table`. `set` maps columns to values (`null` empties a nullable column). |

`due.days` is one of:

| `days` | Days after the date |
|---|---|
| a number, 0–3650 | That many. |
| `{ "byColumn", "values" }` | One number per value of a column of the row (`ladder`: gentle 7, firm 1). Every value of the column needs its days. |
| `{ "setting", "byColumn"?, "index"? }` | Read from a setting when the message is made, and again whenever its inputs move: a number, a list (`index`, 0–9, picks one), or, with `byColumn`, lists per value of that column (`{ "gentle": [7, 21, 45], … }`). |

A due that cannot be worked out (no date yet, a value with no days, a setting that is not there)
is left empty. A held message with no due waits for a person: it is never ready and overtakes
nothing. A queued message with no due goes at once, so give a producer that queues for later a
date it always has.

`where` is one condition on the source row: `{ "column", "eq" }`, `{ "column", "in": [values] }`
or `{ "column", "isNull": true|false }`, exactly one of the three. `before.lead` is
`{ "via", "table", "column", "fallback"?, "max" }`: the number of hours before, read from `column`
(an `int`) of the row that `via` points at, else from the settings `fallback`, and never more
than `max` hours (1–336). `max` is also how far ahead Adminium looks. A reminder is queued with
its moment in `columns.due`.

A source row produces each kind once. A reminder is produced again only when its moment moves; a
batched message, once its window has closed. Sample data, imports and undo fire no producer when
they are written. A sample row never has a message at all. An imported row is a real one, so the
minute's look-over still makes its `before` reminder when the moment comes, and a held producer's
messages for it (an imported sent invoice gets its reminders).

### Held messages

A producer with `hold` writes its messages `held`, each with its own due moment, and nothing is
sent until a person approves one. An invoice's three reminders are made when it is sent, each due
some days after its due date; "ready" means held and due.

```json
{ "kind": "invoice-rung-1", "link": "invoice_id", "hold": true,
  "onChange": { "table": "invoices", "column": "status", "to": "sent" },
  "due": { "date": "due_on", "at": "09:00",
           "days": { "setting": { "addOn": "invoices", "setting": "ladders" }, "byColumn": "ladder", "index": 0 } },
  "supersede": "rungs",
  "dropWhen": [{ "column": "balance", "lte": 0, "reason": "paid" },
               { "column": "status", "eq": "void", "reason": "void" }],
  "onSent": { "table": "projects", "via": "project_id", "set": { "status": "paused" } } }
```

What a person may do to a message, through any screen or the data API:

- **Approve** a held one: it becomes `queued`. They may rewrite it first: `bodyOverride` is sent
  in place of the template's blocks, as plain paragraphs, and `subjectOverride` in place of its
  subject. `approvedBy` records who approved it. One approved before its day goes at once.
- **Skip** a held or queued one: it becomes `skipped`, with the reason `by-hand`.
- **Queue again** a failed one.

Only Adminium marks a message `sent` or `failed`, and a sent message stays as it was sent. A new
row a person makes starts `queued` or `held`.

Once a minute Adminium looks over waiting messages: it re-dates any whose date inputs moved (a new
due date, a changed ladder), skips those `dropWhen` no longer needs, and skips as `overtaken` the
earlier messages of a `supersede` group once a later one has come due. It also makes a held
producer's message for a watched row in the state that has none of that kind yet (after a crash
between a write and its producer, or for an imported sent invoice). It judges all of this again
just before it sends. `skipReason` records why a message was skipped: `overtaken`, `paid`,
`void`, `no-longer-needed` or `by-hand`.

A held message is made even with no address on file (never for a person who opted out of a
producer that asks `optIn`): the address is looked up again when it is approved and when it is
sent.

An `onSent` change is made after the message's status is saved, as an ordinary write of that
row, and is never a reason to send the message again. It is held to the row's rules and
[states](#states) like any write, made by Adminium itself, which holds no role: a move kept for
some `roles` is refused to it. `effectAt` records when it was made, or `effectError` why it was
refused.

### emailTemplates

Up to 32 templates. Each is stored as the app's: an operator can edit it, and an edited template
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
| `attach` | no | `{ "kind", "link" }`: a document the email carries, drawn by an add-on for the row the outbox link `link` names (a receipt for a sale). `kind` is a document kind (see [Documents](#documents)); `link` is one of the outbox's `links`. A message whose document cannot be drawn fails rather than going without it. |

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
| `methods` | yes | At least one of `GET`, `POST`, `PATCH`. `PATCH` needs a `claim`, a `claimedBy` that is not `optional`, or a `visibleWith`. |
| `kind` | no | `records` (the default) or `availability`. |
| `key` | no | The browser key that serves the entry: `customer` (the default) or a name in [`publicKeys`](#publickeys). |
| `select` | no | The columns a response carries. Default: every column the app declares for the table. An entry with `claimedBy` must list them. |
| `writable` | no | The columns a create or change may set. Never a column whose value Adminium decides. |
| `writableValues` | no | `{ "<column>": [1–32 values] }`: the only values a browser may write into a writable column, on a create or a change. Each value must fit the column. |
| `writableWhen` | no | The state a row must be in to be changed, per column: `[1–32 values]`, where `null` stands for "still empty" (on a nullable column); `"from-now"`, a `timestamptz` still ahead; `{ "within": <minutes> }`, a `timestamptz` no more than that many minutes ahead (1–1440; a past time always passes; at most one per entry); `"from-today"`, a `date` of today or later on the venue's calendar; `"before-today"`, a `date` already past. Needs `PATCH`. |
| `requires` | no | 1–8 `writable` columns every write through the entry must fill: accepting a proposal carries the name typed as its signature. |
| `filters` | no | Rows the endpoint can reach at all. See [Filters](#filters). |
| `defaults` | no | Values the server writes whatever the browser sends. |
| `claim` | no | How a person proves who they are: by a row's details, by a link emailed to them, or by a token. Makes the entry its key's identity. See [A person's own rows](#a-persons-own-rows). |
| `claimedBy` | no | `{ "table", "column", "optional"? }`. The entry reaches only the rows of the person its key's identity claimed. |
| `visibleWith` | no | `{ "table", "via" }`. The entry reaches a row only where the entry on `table` (on the same key) reaches the row it belongs to: an invoice's lines are exactly as visible as the invoice. See [Rows visible with their parent](#rows-visible-with-their-parent). |
| `level` | no | `lookup` (the default) or `verified`: the session the entry needs. Only with `claimedBy` or `visibleWith`. |
| `files` | no | 1–8 `text` columns holding a file, which a signed-in person may download: the file the row names, never one by its id. Each is in `select`. Needs a `claim`, `claimedBy` or `visibleWith`. |
| `documents` | no | 1–8 document kinds (see [Documents](#documents)) a signed-in person may list and open for the rows the entry reaches. Needs a `claim`, `claimedBy` or `visibleWith`. |
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

A `null` in `writableWhen` pins a value that may be written once: `"signed_name": [null]` takes a
signature while the column is still empty, and never changes it after. The calendar words pin a
date: a proposal still in date may be accepted (`"valid_until": "from-today"`), and one past it may
ask for a new price (`"before-today"`). `"before-today"` takes a `date` column only, never a time,
and the same entry may not write that date: a caller who could move it forward would put the row
back in date on its old terms.

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

A file in `files` stays private: a browser downloads it only at
`GET /api/v1/public/files/<ref>/<row>/<column>` (`<ref>` is the entry's endpoint), which reads the
row exactly as the entry's list would (its filters, its claim, its parent), then serves the file
that column names, from the key's own database. A row the session cannot reach, an empty column
or a link to somewhere else serves nothing (`404`), and no other public route serves a file.

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

An entry with `claim` is its key's **identity**. A caller proves who they are and gets a session on
that row. Each key has at most one identity. A claim takes one of three forms.

**By the row's details**: `{ "match", "verify"?, "email"? }`. The caller proves they know a row's
details (a mobile number and a date of birth).

| Field | Rule |
|---|---|
| `match` | 1–3 columns the caller must match. |
| `verify` | `"email-code"`: the session starts at `lookup`, and a code emailed to the row's own address raises it to `verified`. |
| `email` | With `verify` only: the `text` column holding the address. |

**By a link emailed to the person**: `{ "verify": "email-link", "email" }`. The person types only
their address, and Adminium emails a one-use link (and a code, for another device). The session
opens at `verified` from the link; a typed address alone opens nothing. `email` is the `text`
column holding the address. The entry asks the human check (`"humanCheck": true`), because anyone
can type an address, and every entry its sessions read says `level: "verified"`.

**By a token**: `{ "by": "token", "column", "expires"?, "stopped"? }`. An unguessable code in a
column opens that one row, with no email at all: a handover page shared by link. `column` is a
`text` column with a [`code`](#column-rules) rule of length 16, so Adminium fills it. `expires`
is a `date` or `timestamptz` after which the link opens nothing; `stopped` a `bool` that switches
it off. A token opens its row to whoever holds the link, so it is served on a
[key of its own](#publickeys) that no staff signs in, and every entry on that key only reads
(`GET`).

A session opened by a token is checked against the row on every request: once the row is
stopped, past `expires`, or given a new code, the link and every session it opened reach nothing,
at once. Nobody types a code, not staff and not an import. To make a new link, staff with
`update` on the table call `POST /api/v1/data/<connection>/<table>/<record>/regenerate-code` with
`{ "column": "share_token" }`: a fresh code is written, and the old one never opens anything
again.

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
  `PUBLIC_CLAIM_LEVEL`, and needs an identity that sends a code or a link. A code is six digits, lasts
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

### Rows visible with their parent

An invoice's lines and payments are not the person's own rows by a column of their own: they are
the invoice's. `visibleWith` reaches them through the entry that reaches the invoice, so a draft's
lines stay as hidden as the draft.

```json
{ "table": "invoices", "methods": ["GET", "PATCH"], "level": "verified",
  "claimedBy": { "table": "clients", "column": "client_id" },
  "filters": [{ "column": "status", "op": "in", "value": ["sent", "void"] }],
  "select": ["number", "total", "balance", "client_paid_at"],
  "writable": ["client_paid_at"], "writableWhen": { "client_paid_at": [null] },
  "documents": ["invoice"] },
{ "table": "invoice_lines", "methods": ["GET"], "level": "verified",
  "visibleWith": { "table": "invoices", "via": "document_id" },
  "select": ["description", "qty", "rate", "amount"] },
{ "table": "payments", "methods": ["GET"], "level": "verified",
  "visibleWith": { "table": "invoices", "via": "document_id" },
  "select": ["number", "amount", "paid_on"], "documents": ["receipt"] }
```

| Field | Rule |
|---|---|
| `table` | The parent's table. Exactly one other entry on the same key reads it with `GET`: that entry is the parent. |
| `via` | This table's foreign key to the parent, or the parent's foreign key to this table. |

A row is reached only where the parent entry reaches the row it belongs to, with the parent's
filters and claim. An entry may be at most two steps from the entry its person claims (a
project's versions, through the project), and the chain must lead to a claimed person. An entry
with `visibleWith` takes no `claim` or `claimedBy`. It may `PATCH` the rows it reaches, naming
what it may write in `writable`, but not when a parent on its way up is on its own table: one
statement cannot change such a row on every database. On a key whose identity signs in by an
emailed link, it says `level: "verified"` like every other entry.

Where `via` is the parent's foreign key (a proposal naming its terms), that column is the link the
child's rows are read by. No entry on the key that creates or changes the parent's rows may write
it, choose its values or fill it by default (`writable`, `writableValues`, `defaults`): a browser
that could would re-point its own row at another person's child and read it. An entry that only
reads writes nothing, so it does not count.

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
| `requiresStaff` | yes, but see below | `{ "role" }`: one of the app's roles. It must be `screensOnly`, with no `cloneFrom` and no grant but `app:@:staff`, because the screen stands where anyone can walk up to it. |
| `enabledBy` | no | `{ "table", "column" }`: a bool of the settings table. While it is false the key answers `PUBLIC_KEY_OFF`. Read as `requireSetting` is, and trusted for 15 seconds. |

`customer` cannot be declared here, and at least one entry must name each key. A request without
the right staff sign-in is refused with `PUBLIC_STAFF_REQUIRED`; a super-admin is refused too.
Claims through a staff-bound key ask no proof, and their sessions last 3 minutes. See
[A kiosk](/guides/apps/public-access/#a-kiosk).

A key with no `requiresStaff` is a **share key**: nobody signs it in, so it opens one row by its
[token](#a-persons-own-rows) to whoever holds the link, and reads nothing else. Its identity entry
claims `by: "token"`, and every entry on it is `GET` only, reaching the rest through
`visibleWith`:

```json
"publicKeys": { "handover": {} },
"publicAccess": [
  { "table": "projects", "key": "handover", "methods": ["GET"], "select": ["name", "handover_file"],
    "claim": { "by": "token", "column": "share_token", "expires": "share_expires_on", "stopped": "share_stopped" },
    "files": ["handover_file"] },
  { "table": "deliverable_versions", "key": "handover", "methods": ["GET"], "select": ["v", "file"],
    "visibleWith": { "table": "projects", "via": "project_id" }, "files": ["file"] }
]
```

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
point at it.

A column numbered [without gaps](#numbers-without-gaps) is spelled `null` in every sample row
(`"number_seq": null`); its `format` text is whatever the row gives (its own spelling, such as
`INV-S2041`), or empty. A sample row then
stays off the real series: the first real invoice is still number one. Adding the sample is
refused when a row leaves a gapless column out or gives it a number.

A value is plain JSON, or one of these directives:

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

Beside its `@label`, a row may carry the row directive `@byClock`, so that a sample day's
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
  `publicKeys`, `outbox`, `emailTemplates`, `sampleData`, `seeds`, `addOns` or `documents`. An
  add-on's own screens are code it ships, declared under `addOn.pages`.
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
| `shapes` | no | 1–8 shapes apps build their tables on. See below. |

Contract ids and slot ids come from closed registries in the add-on contracts package. How
Adminium runs add-on code, and why only first-party add-ons are accepted, is explained in
[Add-on trust](/anatomy/decisions/add-on-trust/).

### Shapes

A shape is what an app's tables are [built on](#tables-built-on-an-add-ons-shape): named parts, each
with its columns, rules and states, the document profiles made for an app's tables, and the
messages an app built on it sends.

| Field | Required | Rule |
|---|---|---|
| `name` | yes | kebab-case. An app names the shape `<add-on key>/<name>@<version>`. |
| `version` | yes | 1–99. A change an app's tables cannot follow is a new version. |
| `parts` | yes | At least one, keyed by a snake_case part name: `{ "columns", "states"? }`, with 1–60 [columns](#columns) and optional [states](#states). |
| `documentProfiles` | no | Up to 8 [documents](#documents), each naming the `part` it is drawn for instead of a `table`, with no `addOn` and no `feature`. |
| `outbox` | no | `{ "producers", "templates"? }`: 1–16 [producers](#outbox), whose tables are the shape's parts, and up to 16 templates, each an [email template](#emailtemplates) with a `kind` (the producer's) instead of a `key`. |

A part is checked the way an app's tables are, with the parts of all the add-on's shapes as the
tables. A column's `references` names another part of the same shape (`"document"`), or a part of
another of the add-on's shapes (`"quote@1/document"`). A rule in a part that reads a setting reads
one of the add-on's own (`{ "addOn": "<its key>", "setting" }`), since the add-on cannot know an
app's settings row.

## Validation

Adminium validates a manifest when a package is uploaded or downloaded from the catalogue, and
refuses an invalid one before anything is written. The refusal lists every problem,
each with the path of the field (`requiredSchema.tables.0.columns.2.default`) and a message. The
checks are:

- **The schema.** Every field on this page, its type and its limits. Every object is strict, so a
  misspelled or unknown field is an error.
- **Cross-references.** Every name the manifest uses must be declared in it, and be of the right
  type: a rule's columns, a formula's inputs, a setting a rule reads, a capacity's or a booking's
  tables and columns, a table's states and the child tables tied to them, a public entry's table
  and columns, a public key's role, the outbox's columns and templates, a document's columns, an
  add-on a shape or a document needs, a page's feature, an option list, a foreign key's target. A `PATCH` without a claim, a writable column that Adminium decides, and an
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

Beside `issues`, `validateManifest` returns `warnings`: advice that never refuses a manifest. A
manifest with warnings validates. Today there is one: a column that is neither nullable nor given
a `default`, a role or a rule that fills it will be `NOT NULL` once installed, so every new row
must give it a value, and a draft saved half-filled is refused. Keep warnings apart from issues in
your CI, so that new advice never fails a build.

```json
{ "ok": true, "manifest": { … }, "warnings": [
  { "path": "requiredSchema.tables.2.columns.4",
    "message": "\"invoices.client_id\" has no default and is not nullable, so it will be required at install: every new row must give it a value" } ] }
```
