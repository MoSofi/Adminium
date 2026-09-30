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
  "compatibility": { "minAdminiumVersion": "0.3.7" },
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
  "minAdminiumVersion": "0.3.7",
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
| `shape` | no | `<name>@<version>`, such as `menu@1`. Two apps that declare the same shape on a table can use one table between them. See [Shared tables](#shared-tables). |
| `builtOn` | no | `<add-on key>/<shape name>@<version>`, such as `invoices/invoice@1`: the table is built on a shape an add-on defines. Needs `part`. See [Tables built on an add-on's shape](#tables-built-on-an-add-ons-shape). A table has `shape` or `builtOn`, not both. |
| `part` | with `builtOn` | snake_case: which part of the shape the table is (`document`, `lines`, `payments`). Only a table with `builtOn` has one. |
| `capacity` | no | A limit on how much of a pool the table's rows may take (a time slot, a ticket type, a room type's nights), or a list of up to three; see [Capacity](#capacity). |
| `booking` | no | Rows that book a person's time, never overlapping; see [Booking](#booking). A table has `capacity` or `booking`, not both. |
| `states` | no | The states a row moves through, what is locked in each, and the child tables tied to them; see [States](#states). |
| `unique` | no | 1–8 sets of 2–4 columns no two rows may hold the same values in together; see [Columns unique together](#columns-unique-together). |

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
| `index` | no | `true`: a plain index on a foreign key a [limit](#capacity) or a [total](#totals-and-balances) counts by, so the count reads the rows it needs and not the whole table. Only on such a foreign key, and never on one that is `unique` already. |
| `label` | no | A [label](#conventions) for the column: a form field, a list heading. |
| `rules` | no | Rules Adminium keeps on the column; see [Column rules](#column-rules). |

A `NOT NULL` column with no default refuses every insert that leaves it out, which includes every
record added from a form that does not show it. Give such columns a `default`, or make them
`nullable`.

`unique` becomes a unique constraint named `uq_<table>_<column>`, where `<table>` is the real
table name (`uq_clinic_patients_email`). It is made when Adminium creates the table, and by an
update that adds the column or finds it without one (on SQLite, a unique index of the same name).
Before adding it to a column that already has rows, the update's check makes sure no two rows hold
the same value, and names the column if they do; nothing changes until they differ. A code column
and a number without gaps are unique the same way, a number counted per parent row together with
its parent. On MySQL a unique text column holds at most 768 characters (`maxLength`): MySQL
indexes no longer key, so a longer one is refused on the check, at install and on update.

#### Columns unique together

A table's `unique` lists sets of columns that are unique together: one waitlist entry per show per
address, one check-in per ticket per day.

```json
{ "ref": "check_ins", "columns": [ … ],
  "unique": [["ticket_id", "day"]] }
```

Each set names 2–4 of the table's columns, each once; a table has up to 8 sets, and no set twice.
A row with any of the set's columns empty never collides. The columns must be ones an index can
hold: not `json` or `blob`, and a `text` column with `maxLength` (a `code` column counts). A set
that a number counted per parent already keeps unique (a `gapless` sequence with a `scope`, and
its scope) is refused as said twice, and so is a set on a table [built on an add-on's
shape](#tables-built-on-an-add-ons-shape), whose own writes could break it.

A set becomes a unique constraint when Adminium creates the table (a unique index on SQLite), and
an update that adds a set to a table that already has rows first checks that no two rows repeat
it: the check names the table and columns (`UNIQUE_DUPLICATES`), and nothing changes until they
differ. A write that would repeat a set is refused `409` `UNIQUE_VIOLATION`, with
`details.columns` naming the set. A plain [`index`](#columns) is added the same way, at install or
by an update.

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

`"now"` is filled by Adminium on every create, through every door, so what the create works out can
read it (a visit's [hours](#hours-between-two-moments) are there from the start). On MySQL the
database is given no default for it at all: an app's `timestamptz` is a `DATETIME` there, kept on
the Adminium server's clock, and the database — whose sessions Adminium keeps in UTC — could only
fill UTC's. A row written to that table outside Adminium, leaving the column out, gets nothing: it
stays empty, or is refused when the column may not be empty. Adminium also fills a MySQL `DATETIME`
whose database default is `CURRENT_TIMESTAMP` (a table made before, or one of your own) on its own
creates, with the server's own time: before, the database filled it with UTC's time, so on a server
not in UTC a row Adminium makes now differs from one another program stamps. On Postgres and SQLite
the database's own default is kept as well.

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
| `requiredWhen` | `{ "column", "in" }` | The server requires a value only while another column of the same row holds one of the values in `in` (1–32): an away event names who is away, an event in the office names nobody. See [Required for some values](#required-for-some-values). |
| `validation` | `{ "format"?, "min"?, "max"?, "minLength"?, "maxLength"? }` | `format` is `email`, `url` or `phone`. |
| `copy` | `{ "via", "from", "mode"?, "follow"? }` | Copies a value from a linked row. `via` is a foreign-key column of this table, `from` a column of the table it points at. With `mode: "default"` (the default) the copy fills only a value the write leaves out; with `"always"` it always wins. With `"follow": true` it keeps in step when that row changes later; see [Copies that follow](#copies-that-follow). `via` may itself be a copied column (a ticket's show, copied from its type): that copy runs first, in the same write. A column kept from readers is copied only into one kept the same way: a `secret` into a `secret`, a `personal` column into a `personal` one (or a `secret`), and a shared link's code never. The same holds for a stamp that copies a column of its row, and for a formula's inputs. |
| `default` | `{ "from" }` | A value filled on a create that leaves the column empty, read when the row is made. See [Values from elsewhere](#values-from-elsewhere). |
| `sequence` | `{ "start"?, "gapless"?, "startSetting"?, "scope"? }` | The next number in a running series. Without `gapless`, the column's own counter; `start` is at least 1. With `"gapless": true`, a number with no gaps and none repeated. See [Numbers without gaps](#numbers-without-gaps). |
| `format` | `{ "from", "prefix"?, "prefixSetting"?, "pad"? }` | A `text` column written from a gapless number of the same row: the prefix, then the digits padded with zeros (`INV-0042`). See [Numbers without gaps](#numbers-without-gaps). |
| `code` | `{ "length", "prefix"?, "renew"?, "hiddenFromStaff"? }` | A short random code, unique in the column. `renew` makes a new one when the row changes hands; see [Codes that renew](#codes-that-renew). `length` is 4–16; `prefix` is upper case, up to 6 characters plus an optional `-` (`MR-`). A create that leaves it out or empty gets one, a sample row or an import too; a code they bring is kept, but a sample's code for a shared link's `column` is always made anew. A code is no secret by its rule alone: a name that reads like one (`share_token`) keeps it one, unless `secret: false` says otherwise or it is the column a shared link opens a row by, on a table the install made, which staff who read the table see. The public sees a code only where an entry's `select` names it, and a shared link's never. The audit log and the automation logs say `[code]` in its place, and the assistant never reads it. `hiddenFromStaff: true`: a code no desk hands out (an online order's own link) is left out of every staff read, for every role and Super Admin too: rows, exports, live updates and the history. The link still opens its row, and the app's emails still carry it to the row's holder. |
| `formula` | an expression | A number worked out from the row's other columns on every write. See [Formulas](#formulas). |
| `normalize` | `"trim"`, `"email"` or `"code"` | How a `text` value is kept: `trim` without spaces at either end, `email` trimmed and in lower case, `code` compared as a code (upper case, spaces and dashes left out) when a person types one; see [Typed codes](#typed-codes). |
| `lookup` | `{ "from", "table", "column", "where"?, "scope"? }` | A foreign key filled from a code a person types into another column: a discount code, a presale code. See [Typed codes](#typed-codes). |
| `perNight` | `{ "from", "to", "rate", "adjust"? }` | A price worked out night by night: a stay's room total. See [Prices by the night](#prices-by-the-night). |
| `notAfter` | `"today"` or `{ "column", "via"?, "when"?, "strict"? }` | A `date` column is never later than today, in the venue's time zone; or than another date, read as `notBefore` reads it (a credit's nights end by its stay's `depart`). A later date is refused (`out-of-range`). |
| `notBefore` | `{ "column", "via"?, "when"?, "strict"? }` | A `date` column is never earlier than another date column: of the same row, or, with `via`, of the row its foreign key `via` points at (a payment never before its invoice's `issued_on`). `when`: 1–8 [conditions](#conditions-a-move-waits-for) on the row as the write leaves it; the bound holds only while they are met. `strict`: the same day is out too — `true`, or 1–8 conditions it is out under (a guest who left early is credited from the day after the arrival, one who never came from the arrival itself). |
| `retryKey` | `true` | The column a staff create keeps its retry key in, as a 43-letter hash, on a table no public entry creates rows of: a desk's payment sent again after a lost reply answers the payment the first one made (see the REST API's `clientKey`). A `text` column, `unique`, nullable, at least 43 long; one a table. |
| `rollup` | `{ "from", "via", "sum" or "count", "times"?, "unlessSet"?, "where"?, "balance"?, "cap"? }` | A total over child rows, kept up to date as they change. `from` is the child table, `via` its foreign key back to this table, `sum` the column to add up, or `"count": true` to count the rows instead; see [Totals that count and climb](#totals-that-count-and-climb). `times` multiplies each row (a quantity); a child row with a value in `unlessSet` is left out (a voided line). See [Totals and balances](#totals-and-balances) for `where`, `balance` and `cap`. |
| `stamp` | `{ "set", "on", "clearOnBack"? }` | A value Adminium writes when something happens: the moment, who did it, or a deadline. See [Stamps](#stamps). |
| `venueLocal` | `true` | A wall time given with no zone is read in the venue's time zone. |
| `personal` | `true` or `false` | Whether the column is personal data, overriding the guess Adminium makes from the column's name. |
| `secret` | `true` or `false` | Whether the column is a secret no response carries, to anyone, overriding the guess Adminium makes from the column's name (`api_token`, `password_hash`). An entry in [public access](#public-access) that names no `select` leaves a `secret` column out, and a `code` column too. `false` is written only on a table the app's install made: on a table it reuses, a rule that would show a secret or take a personal column's mask off is skipped, the check step says so, and only an operator can show the column, in Studio, as Super Admin. A `secret` the operator set in Studio wins over the app's. On a column of an add-on's shape, only `true`. |

Tones are the dashboard's badge colours: `neutral`, `accent`, `info`, `pos`, `warn` and `danger`.

`copy`, `default`, `sequence`, `format`, `code`, `rollup`, `formula`, `stamp`, `lookup` and
`perNight` are values **Adminium decides**: they are filled on the server, so a browser never
picks a price, a number, a code or a time. So are a rollup's `balance` column, a booking's
late-cancellation [`flag`](#booking) and a [late move's](#late-moves) flag. None of them can be listed as `writable` in [public access](#public-access), and
a primary key cannot take `sequence` or `code`.

One rule decides a column. The one pair allowed is a `copy` with a `default` behind it: the copy
comes first, and the default fills the column when the copy comes back empty (a client's own tax
rate, else the business's). A stamped column takes none of the others.

The [outbox's](#outbox) own columns that Adminium writes (`status`, `sentAt`, `error`,
`skipReason`, `approvedBy`, `effectAt` and `effectError`) take none of these rules, nor `options`,
`validation`, `required`, `requiredWhen`, `notAfter` or `notBefore`: a stamp of who approved a
message would race Adminium for the column, and a rule that refuses a value would refuse what
Adminium writes, so every message the desk makes would be refused, or stuck. Its `to` and
`language`, which Adminium writes when it looks the address up, take none that decide a value, nor
`options`, `required` or `requiredWhen` (a desk leaves `to` empty to have it looked up); a
`validation` of the address a person types is fine. Nor may another column's rule read one of them
where the read could refuse Adminium's write: a note `requiredWhen` the status is `sent`, a `formula`
worked out from `effectAt`, a `notBefore` bound on `sentAt`. The install names the column, and a
Studio save refuses the same rules on an installed outbox's columns.

Every name a rule uses is checked against the manifest: `copy.via` must be a foreign key of the
table, `rollup.via` must point back at this table, and so on. `normalize` is for `text` columns
only.

The rules are kept on every door a row is written through: a form, a bulk edit, an import, an
automation, the public API and an outbox's `onSent` change. `normalize`, `formula` and the
rounding to a `scale` apply on each of them. History keeps what it brings: an import and sample
data are not [stamped](#stamps), not [capped](#totals-and-balances), and not held to `notAfter` or
`notBefore`; an undo puts a row back exactly as it was, with no rule at all. A date refused by
`notAfter` or `notBefore` answers `422` `VALIDATION_FAILED`, the field's code `out-of-range`.
A bound is judged when the date is written, and when its `via` link or a column its conditions read changes. `required` and
`requiredWhen` hold on an import and on sample data too; a value they refuse answers `422`
`VALIDATION_FAILED`, the field's code `required`. On every table, with a rule or without one, text
holding the character U+0000 (anywhere in a JSON value too) is refused the same way, the field's
code `invalid-character`: Postgres cannot store it, and MySQL and SQLite would keep what Postgres
refuses.

The public API answers a refused value with its one `400` `PUBLIC_WRITE_REFUSED`. When the value
was refused for itself, in a column the entry lets the caller write, `params` names the column and
why: `{ "column": "name", "reason": "too-long" }`, the reason `too-long`, `format`,
`invalid-character`, or on a create `required`. A batch adds the row's `index`. Anything else
names no column: a value already taken or pointing at a row that is not there, a value outside
`options`, a date out of bounds, and a column only a change leaves empty, since whether it may be
empty can turn on what the stored row holds.

#### Required for some values

`requiredWhen` asks for a column only while another column of the same row holds one of some
values:

```json
{ "ref": "person_id", "type": "fk", "references": "people", "nullable": true,
  "rules": { "requiredWhen": { "column": "kind", "in": ["away", "sick"] } } }
```

The row is judged as the write leaves it, whenever the write changes either column: a create or an
update that leaves `person_id` empty while `kind` is `away` or `sick` is refused, and so is moving
an event whose `person_id` is empty to `away`. A write that changes neither column is not judged —
a column sent back as it is stored, as the record form sends every field, is no change — so a row
stored before the rule can still be edited. Empty means no value, or only spaces. On a create that
leaves `kind` out, `kind` is its database default: a trip that is away unless it says otherwise
asks for a person. The record form marks the field required as soon as the other column holds one
of the values, and asks nothing of an edit that changes neither.

- **As the database compares.** A `bool` column's yes is a yes in any spelling (`true`, `on`, `y`,
  `1`, ` TRUE`), and it is stored as the answer it names on every engine; a word that is no yes and
  no no is refused. On MySQL a plain text column is compared as MySQL compares it, so `AWAY ` is
  `away` there, and asks for a person; Postgres and SQLite keep `Away` apart from `away`.
- **Two writers at once.** An update that moves `kind` to `away` over a person it did not send, or
  empties `person_id` over a `kind` it did not send, asks the database, in the same statement, that
  what it read is still so. Two people changing one event at the same moment cannot together leave
  it away with nobody named: the second is refused as the first would have been.

`column` is another column of the same table, and every value in `in` must fit it (a value of an
enum, a number for a number column, `true` or `false` for a `bool`). The rule's own column must be
`nullable`: one that is never empty is simply `required`. A column cannot take both `required` and
`requiredWhen`, and a column Adminium fills (`copy`, `default`, `sequence`, `format`, `code`,
`rollup`, `formula`, `stamp`) takes no `requiredWhen`, because nobody is asked for it.

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

`of` may be another total of the row, so money given back is capped by money taken: two totals
over the same payments, `taken` (`where` `kind` `taken`) and `given_back` (`where` `kind`
`given_back`, `balance: { "column": "refundable", "of": "taken" }`, `cap: true`). A refund past what
was taken is refused, and so is lowering a payment taken below what already went back.

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

#### Totals that count and climb

A total may count its child rows instead of adding a column up: how many tickets an order holds,
how many lines a kitchen ticket has.

```json
{ "ref": "ticket_count", "type": "int", "default": 0,
  "rules": { "rollup": { "from": "tickets", "via": "order_id", "count": true,
                         "unlessSet": "refunded_at" } } }
```

A rollup names `sum` or `"count": true`, never both. A count is kept in an `int` or `bigint`
column, and takes no `times`, `balance` or `cap`; `where` and `unlessSet` leave rows out as they do
for a sum.

A total may also add up another table's totals: an option's price into its line, the line into
its order, the order into the customer's lifetime total. Such totals **climb**, at most three
tables high, and never in a circle (a table adding up its own rows, or two tables adding up each
other). A write that moves a total at the bottom settles every total above it in the same
transaction: each level adds up what the level below has just written, then works out its
formulas and balances. Every door that moves a total does this: a create, a change, a delete, a
create with child rows, a bulk edit, an import, an undo, a parent form and sample data. Two
writers take the rows in one order (the highest parent first), so they never wait on each other
crosswise; a line moved to another order while a write was reading it is refused `409`
`WRITE_CONFLICT` with `details.retry: true`, and the same write a moment later goes through.

Sums are exact on every engine, SQLite included: a total is added up from each row's decimal text,
never through a floating-point number.

A capped balance whose `of` is a [formula](#formulas) (a total of subtotal and tax) is judged
against the cap one row at a time; a bulk edit or an import settles it afterwards, without the
cap. So `validateManifest` [warns](#validation) when the formula reads a column that stays
writable while the capped rows can exist: lock those columns with the table's
[states](#states) (and the lines they add up with `lock: true`) in every state a capped row can be
written in or reached from.

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
| `{ "hoursBetween": [start, stop] }` | The hours from the `start` column to the `stop` column, both `timestamptz` columns of the row. See [Hours between two moments](#hours-between-two-moments). |
| `{ "daysBetween": [from, to] }` | The whole calendar days from the `from` date to the `to` date, two `date` columns of the row: a stay's nights. |
| `{ "join": [part, part, …] }` | Text: 2–8 parts, each a column of the row or a piece of text, joined in order. The whole formula, of a `text` column; see [Joined text](#joined-text). |

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

A formula fills a `decimal`, `money`, `int` or `bigint` column, never a `float` (a
[`join`](#joined-text) fills a `text` column). It reads only columns of its own table, and every
column it counts with holds a number; `eq`, `neq` and `isNull` may name any column,
`hoursBetween` names two different `timestamptz` columns and `daysBetween` two different `date`
columns. It
may not read itself, formulas may not read each other in a circle, and an expression nests at most
8 deep. A value a writer sends to a formula column is dropped. Anything that reads another row is a
`copy` or a `rollup`, which already keep in step when that other row changes.

#### Hours between two moments

`hoursBetween` works a time entry's hours out from its start and its stop:

```json
{ "ref": "hours", "type": "decimal", "scale": 2, "nullable": true,
  "rules": { "formula": { "hoursBetween": ["started_at", "stopped_at"] } } }
```

09:15 → 11:45 is `2.50`; 22:30 → 01:15 the next day is `2.75`. The hours are exact and rounded
once to the column's scale, like any formula, and they can be counted with further:
`{ "mul": [{ "hoursBetween": ["started_at", "stopped_at"] }, "rate"] }` is the pay at a rate. An
update that moves only the stop works the hours out again from the start as stored.

- **The time that passed.** Hours are real elapsed time. A column that keeps a zone (Postgres
  `timestamptz`, MySQL `TIMESTAMP`) holds the moment itself. One that keeps none (MySQL `DATETIME`,
  which is what an app's `timestamptz` column becomes on MySQL, Postgres `timestamp`, and SQLite
  text) is read on the Adminium server's clock, the clock Adminium writes such times on. So on a
  server in Europe/London, 00:30 → 03:30 on the night the clocks go forward is `2.00`, and
  00:30 → 02:30 on the night they go back is `3.00`, on every engine. Run the server in the zone the
  times are kept in.
- **A time written without a zone.** Sent for a column that keeps a zone, `2026-09-25 11:45` is
  11:45 on the Adminium server's clock — the moment the hours are counted to and the moment that is
  stored, whatever zone the database's session is in. A stop stamped `now` is that moment too.
- **What SQLite keeps.** A start SQLite fills with `unixepoch()` (seconds since 1970) is read as
  that moment, and so is a text with its zone after a space (`2026-09-25 09:15:00 +02:00`).
- **Empty for a missing, impossible or backwards span.** An empty start or stop leaves the hours
  empty, and so does a day or an hour the calendar does not have (30 February stays no time, not 2
  March). So does a stop before its start: a negative number of hours would quietly take pay off a
  total, so the entry shows no hours until it is corrected. A stop equal to the start is `0.00`.
- **Too many to keep.** Hours the column cannot hold (centuries in a `numeric(6, 2)`) are refused,
  `422` `VALIDATION_FAILED` with the code `out-of-range` on the moments they are counted from, on
  every engine — never left for the database to refuse or, on SQLite, to keep. Any formula whose
  result its column cannot hold is refused the same way.

`daysBetween` counts calendar days the same way: two `date` columns of the row, the nights of a
stay from its arrival to its departure. A night the clocks change is still one night. An empty
date, or a `to` before its `from`, leaves the result empty.

#### Joined text

A `join` makes a `text` column from other columns and pieces of text: a guest's full name, a
line's description.

```json
{ "ref": "full_name", "type": "text", "maxLength": 160, "nullable": true,
  "rules": { "formula": { "join": ["first_name", " ", "last_name"] } } }
```

A part that reads as a snake_case name is a column of the row; any other part (a space, `" · "`)
is text written as it is. A join reads `text`, `int` and `bigint` columns only: a decimal, a yes or
no, or a time would be spelled differently by each database. An empty column is left out, and so
is the text between it and its neighbour, so a guest with no last name is "Mia", not "Mia ". The
result is trimmed, and empty when every column is. A join is the whole formula of its column,
never a part of a sum.

A join that reads personal data lands it only in a personal column. A guest's first and last
names beside their email read as personal by their names, so the joined name needs
`"personal": true` too; without it the check refuses the manifest. The same holds for a `copy`
and a stamp's copy.

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

A `{ "table", "column" }` setting, wherever a rule reads one (a default, a limit's size, a move's
condition, a moment's time), names a table that holds **one row**: the outbox's
[`settings.table`](#outbox), or a table that stands alone, with no foreign key of its own, none
pointing at it, and no states, limits or booking. Adminium reads that row when the rule runs. A
moment, a state condition or a stamp's amount that finds two rows there reads nothing rather than
guess which one is meant.

#### Copies that follow

A plain `copy` is taken when the row is written. With `"follow": true` it keeps in step: when the
row it copies from changes, every row that copies it takes the new value in the same write. A
hotel stay's extras copy the stay's nights and guests, so breakfast for two over three nights
becomes breakfast for three over four the moment the stay changes.

```json
{ "ref": "nights", "type": "int", "nullable": true,
  "rules": { "copy": { "via": "stay_id", "from": "nights", "mode": "always", "follow": true } } }
```

The copy is written, then every formula over it, then the totals it moves are settled into the
row it follows (the stay's total, tax and balance), before the change commits; if any of that is
refused, nothing is kept. A paid stay whose balance would fall below zero is refused
`409` `BALANCE_EXCEEDED`.

The rules that keep a follow sound:

- it always wins (`mode: "always"`), and follows one level: the column it copies does not itself
  follow another row;
- it never follows a total, a balance or a stamp, nor a formula over one: those change without a
  change of the row, so the copy would keep an old value;
- the row it follows is not worked out from this table's own totals (a loop);
- a total another table keeps of these rows reads none of what the follow writes, including the
  link it groups by: a follow that moved rows between another table's totals would leave those
  totals behind.

More than 500 rows following one changed row refuse the whole write, `409` `FOLLOW_TOO_MANY`
(`details.table`, `details.count`), rather than leave some behind. A bulk edit, an import or a
public batch that would move a paid balance below zero through its followers, or could not write
them under the caller's role, or would move more than 500, is refused before anything is written:
`409` `BALANCE_ONE_AT_A_TIME`. Make such changes one row at a time.

#### Prices by the night

`perNight` works a price out night by night: for each night from `from` up to the day before `to`,
the base rate read from the row `rate.via` points at, plus every adjustment row that matches that
night (a weekend, a season). Each night is rounded to the column's [scale](#decimal-places), and
the column holds their sum.

```json
{ "ref": "room_total", "type": "money", "scale": "currency", "nullable": true,
  "rules": { "perNight": {
    "from": "arrive", "to": "depart",
    "rate": { "via": "room_type_id", "column": "base_rate" },
    "adjust": { "table": "rate_rules",
                "match": { "via": "room_type_id", "weekdays": "weekdays", "from": "from_date", "to": "to_date" },
                "add": "amount", "name": "name", "where": { "column": "active", "eq": true } } } } }
```

| Field | Rule |
|---|---|
| `from`, `to` | Two different `date` columns of the row: the first night, and the day after the last. |
| `rate` | `{ "via", "column" }`: a foreign key of the row, and the number column of the row it points at that holds the base rate. Never a secret or personal column. |
| `adjust` | Optional. `table` holds the adjustments; `add` is the number added to a night (negative for a discount) and `name` the `text` a night's line is tagged with. |
| `adjust.match` | Which adjustments apply to a night. `via`: a foreign key to what `rate.via` points at (empty on a row: every type). `weekdays`: a `text` column of at least 27 characters listing nights like `fri,sat` (empty: every night). `from`, `to`: `date` columns, the first and last night it applies on, both included (empty: open). |
| `adjust.where` | `{ "column", "eq" }`: only adjustments whose column holds the value (`active` is `true`). The column may not be nullable. |

The column is a `decimal`, `money`, `int` or `bigint`, and a table has one such price. A create
always works it out. A change works it out again only when it writes the dates or the rate's link
to something new, so rates edited later never re-price a stay already booked, and a form that
sends the whole row back keeps the booked price. An import keeps a figure it brings and works out
one it leaves out. Formulas read the price (a subtotal, the tax, the total), so they run after it.

The nights themselves are worked out, never stored: a dry run answers them (`date`, `rate`,
`base`, `tags`), staff read them at `GET /api/v1/data/<connection>/<table>/<id>/nightly`, and a
[document](#documents) can list them. When the rates changed after the stay was priced, the lines
come back as one line equal to the stored figure, so a folio never prints lines that disagree with
its total. A rate rule that cannot be read refuses the write `409` `NIGHTLY_RATE_UNREADABLE`.

#### Typed codes

A `lookup` fills a foreign key from a code a person types: a discount code on an order, a presale
code on a ticket. The browser never names the codes row itself; Adminium finds it.

```json
{ "ref": "promo_code", "type": "text", "maxLength": 32, "nullable": true },
{ "ref": "promo_id", "type": "fk", "references": "promo_codes", "nullable": true,
  "rules": { "lookup": { "from": "promo_code", "table": "promo_codes", "column": "code",
                         "where": [{ "column": "active", "eq": true },
                                   { "column": "valid_until", "notBefore": "today", "orEmpty": true }],
                         "scope": [{ "column": "event_id", "equals": "event_id", "orEmpty": true }] } } }
```

| Field | Rule |
|---|---|
| `from` | The nullable `text` column of this row the code is typed into, up to 64 characters, with no rule of its own that decides it. |
| `table`, `column` | The codes table, and its `text` column the code is found by. The rule's own column is a nullable foreign key to `table`. `column` finds one row: it is `unique`, a [`code`](#column-rules) column, or unique together with the `scope` columns in one of the table's [sets](#columns-unique-together). It is compared as a code, so it has `normalize: "code"` unless it is a `code` column. Never the code a shared link opens its row with. |
| `where` | Up to 4 conditions on the codes row: `{ "column", "eq" }`; `{ "column", "notBefore": "now" or "today", "orEmpty"? }`, a date or time not yet past (`valid_until`); `{ "column", "notAfter": "now" or "today", "orEmpty"? }`, one already reached (`valid_from`). `orEmpty` lets an empty column pass. |
| `scope` | 1–2 `{ "column", "equals", "orEmpty"? }`: the codes row's `column` equals this row's `equals` column (this show's codes). With `orEmpty`, a codes row whose `column` is empty matches any (a code good for every show). |

A typed code is read the way codes are kept: upper case, spaces and dashes left out. A column
Adminium [makes codes in](#column-rules) reads it as a claim does, its prefix put back, `O` as `0`,
`I` and `L` as `1`. Two stored codes that fold alike are told apart by the exact spelling.

Every miss is one answer: no such code, a code switched off, expired, another show's, or two that
fold alike are all refused `422` `VALIDATION_FAILED` on the typed column with the code `unknown`
(through the public API, `PUBLIC_WRITE_REFUSED` with `reason: "unknown"`), so a guesser learns no
more from one miss than from another. A code whose uses are all taken, counted by a
[parent limit](#parent-limits) through the link, is refused on the typed column as `used-up`.
Emptying the typed column empties the link, and every copy made through it: a code taken off
takes its discount with it. A bulk edit, a form's child rows and an import find each row's code
the same way, and an unknown code refuses just that row. A table resolves at most two typed codes.

A code typed to **read** rows rather than write one (a presale code that shows its ticket type) is
a public entry's [`unlockBy`](#codes-that-unlock-rows).

#### Codes that renew

A ticket's code is the door's proof. When the ticket goes to somebody else, the old code must
stop working at once, and the new holder gets one the old holder never saw. `code.renew` says
what makes a new code:

```json
{ "ref": "code", "type": "text", "nullable": true,
  "rules": { "code": { "length": 8, "renew": { "on": { "column": "holder_customer_id", "changed": true } } } } }
```

`on` is one trigger or a list of 2–3: `{ "column", "changed": true }`, any change of another
column of the row, or `{ "column", "values" }`, that column moving to one of 1–16 values (a
transfer accepted). The watched column is not a code itself, not `json` or `blob`, and a `changed`
trigger watches a column a person changes or a stamp writes (a holder stamped in as an offer is
taken renews too).

The new code is written in the same statement as the change: the old one stops as the write
commits, and every session a [token link](#a-persons-own-rows) on that column opened stops with
it. What never renews: a create (it makes a code anyway), an import or other history, a change that
sends back the value the row already holds, and a server action that writes the code itself (a
[new link](#a-rows-own-link)). A [timed move's](#timed-moves) `set` renews like any other change.
Undoing a change of hands renews once more, so neither the old code nor the one handed on works
after it; see [Undo of a move](#undo-of-a-move). A renewed code is never shown to a public caller
in the change's reply, and only to staff who may read the table.

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
| `on` | When: `"create"`; `{ "column", "values" }`, another column of the table and 1–16 values it must change to; `{ "column", "filled": true }`, the moment another column, a nullable one, is first filled; `{ "columns": [...] }`, whenever one of 1–8 other columns changes (a create sets them all); or a list of 2–3 of these, any of which writes the stamp. |
| `clearOnBack` | `true`: emptied again when a move marked [`undo`](#undo-of-a-move) takes the row back out of a state the stamp watches (the time an order was marked ready, when the kitchen undoes the Ready). The column is nullable, the stamp watches the table's state column, and some `undo` move leaves one of the states it watches. |

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
| `{ "addMinutes": { "minutes" or "hours", "notAfter"? } }` | The moment so many minutes or hours from now: a hold for ten minutes, an offer open for a day. The amount is a number or a whole-number setting. `notAfter` is a [moment](#moments) it never passes (an offer ends at the doors at the latest); a missing moment caps nothing. | `timestamptz` |
| `{ "deadline": { "days", "time", "notAfter"? } }` | `days` after today on the venue's calendar, at `time` (`"HH:MM"` or a text setting), but never later than `notAfter`: a transfer due in five days at 18:00, or three days before the show. | `timestamptz` |
| `{ "moment": <moment> }` | A [moment](#moments) of the row or a linked row, worked out whenever the stamp fires: a stay's cancel-by, from its arrival. Read from other columns, never its own. A moment that cannot be found writes nothing. | `timestamptz` |

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
no `copy`, `default`, `sequence`, `format`, `code`, `rollup`, `formula`, `lookup` or `perNight` as
well, and a stamp watches a column other than its own.

A stamp that works out a moment again whenever what it reads changes: a stay may be cancelled
free until 48 hours before 15:00 on its arrival day, and moving the arrival moves the deadline.

```json
{ "ref": "cancel_by", "type": "timestamptz", "nullable": true,
  "rules": { "stamp": {
    "set": { "moment": { "column": "arrive", "time": { "table": "settings", "column": "arrive_from" },
                         "minus": { "hours": { "table": "settings", "column": "cancel_hours" } } } },
    "on": { "columns": ["arrive"] } } } }
```

An offer that lasts as many hours as the settings row says, but never past the show's doors:

```json
{ "ref": "offer_until", "type": "timestamptz", "nullable": true,
  "rules": { "stamp": {
    "set": { "addMinutes": { "hours": { "table": "settings", "column": "offer_hours" },
                             "notAfter": { "column": "doors_at", "via": "event_id" } } },
    "on": { "column": "status", "values": ["offered"] } } } }
```

### Moments

Every rule that reads a point in time reads it as a **moment**: a move allowed only after or
before a time, a move Adminium makes when a time passes, a deadline a stamp writes, a public change
open only inside a window, a hold that lasts until a time. A moment is a date or time column of the
row, or of the row one of its links points at, at a wall time of the venue's day, shifted by an
amount, with fallbacks when its column is empty.

```json
{ "column": "starts_at", "via": "event_id", "minus": { "minutes": 30 } }
```

| Field | Rule |
|---|---|
| `column` | A `date` or `timestamptz` column: this row's own, or the linked row's with `via`. |
| `via` | A foreign key of this row: the moment is read from the row it points at. One link, never two. |
| `time` | The wall time on the column's day, on the venue's clock; a `date` column needs one. `"HH:MM"`; a `text` setting `{ "table", "column" }` holding one; the venue's opening or closing hour that weekday, `{ "hours": { "table", "weekday", "open"?, "opens"?, "closes" }, "edge": "opens" or "closes" }`; or a time kept on the row itself, `{ "column" }` (a guest's arrival time on their stay). |
| `plus`, `minus` | A shift forward or back, not both: exactly one of `minutes` (up to 1,000,000), `hours` (up to 16,666) or `days` (up to 36,600), each a number or a whole-number setting. |
| `or` | 1–3 fallback moments of the same shape (without their own `or`), read in turn when this one's column is empty: an event's own refund deadline, else seven days before it starts. |

Minutes and hours are elapsed time: 48 hours before 15:00 is 48 real hours, whatever the clocks
did. Days are calendar days at the same wall time: 7 days before 20:00 is 20:00. A day the hours
table marks closed, or has no row for, ends at midnight. A moment whose column is empty, whose
linked row is missing, or whose setting cannot be read, is no moment at all, and the rule reading
it says what that means: a move waiting for it is refused, a deadline capped by it is not capped.

A time kept on the row (`{ "column" }`) is a `text` column of at least 5 characters holding
`HH:MM` (`H:MM` and the database's `HH:MM:SS` read too). Every column a moment reads that way is
checked when it is written: a value that does not read as a time of day ("9pm") is refused `422`
`VALIDATION_FAILED` with the code `format`, on every door. The moment is compared with the clock
the write reads under its locks, or with the time a staff device says a scan was made (see
`occurredAt` in the [REST API](/reference/rest-api/)).

### Capacity

`capacity` limits how much of a pool a table's rows may take: the guard behind a booking form, a
ticket shop and a hotel's rooms. A rule names its pool one of three ways:

| Kind | The pool | Example |
|---|---|---|
| `slot` (the default) | Rows add up per start time. | Tables in a restaurant, orders in a pickup slot. |
| `parent` | Rows take from a limit held on the row they point at. | Tickets of a type, today's portions of a dish, the uses of a code. |
| `night` | A row takes one unit on every night of its stay, from a pool counted in another table. | Rooms of a type, a hotel's parking spaces. |

`capacity` is one rule, or a list of up to three (a pool per room type and a pool per room on the
same stays). A table has one slot rule at most. Numbers can be literal, or read from the app's
[one-row settings table](#values-from-elsewhere) as `{ "table": "<ref>", "column": "<ref>" }`, so a
venue can change them without a new release. Every table a rule names is one of the app's own, by
its short ref; columns of a row reached through a foreign key (`via`) are named plainly.

Which rows count is said by `countWhere`: `{ "column", "values", "via"? }`, only rows whose column
holds one of the values (a cancelled order holds nothing), or a list of two, one on the row and one
on the row it belongs to (a ticket's status and its order's), `via` being the foreign key to that
owner. A rule reads through one owner only: every `via` of its conditions, hold and day names the
same foreign key.

Give the foreign keys a limit counts by [`index: true`](#columns), so the count under the limit's
lock reads the rows it needs rather than the whole table.

#### Slot limits

```json
"capacity": {
  "slot": "pickup_at", "amount": 1, "perSlot": { "table": "settings", "column": "orders_per_slot" },
  "slotMinutes": 15,
  "countWhere": { "column": "status", "values": ["placed", "confirmed", "preparing", "ready"] },
  "hours": { "table": "opening_hours", "weekday": "weekday", "open": "open", "opens": "opens", "closes": "closes" },
  "closures": { "table": "closures", "from": "from_date", "to": "to_date", "active": "active" },
  "pauses": { "table": "slot_pauses", "slot": "slot_at", "active": "active" },
  "windowDays": 7, "noticeMinutes": 20
}
```

| Field | Required | Rule |
|---|---|---|
| `kind` | no | `"slot"`, or left out. A rule with no `kind` is a slot rule, and reads exactly as it always has. |
| `slot` | yes | The `timestamptz` column holding each row's time. |
| `amount` | yes | How much a row takes: an `int` column (a party size), or a number from 1 to 1000. A column a guest asks [availability](#availability) about needs a largest value, `validation.max`. |
| `perSlot` | yes | How much one slot holds. A non-negative integer, or a settings reference. |
| `slotMinutes` | yes | Slot length in minutes, or a settings reference; at least 1. |
| `countWhere` | no | Which rows count (above). |
| `windowDays` | no | How many days ahead bookings are open. |
| `opens`, `closes` | no | `"HH:MM"`, or a settings reference. Not with `hours`. |
| `hours` | no | Weekly hours in place of `opens` and `closes`: `{ "table", "weekday", "open"?, "opens", "closes" }`, one row per weekday. `weekday` is an enum of exactly `mon` … `sun`, `opens` and `closes` are `text` columns holding `HH:MM`, `open` a bool. |
| `closures` | no | Days the venue is closed, `{ "table", "from", "to", "active"? }`, `from` to `to` included (`date` columns). |
| `pauses` | no | Slots the venue has paused (a kitchen that is full): `{ "table", "slot", "active"? }`, `slot` a `timestamptz`. |
| `noticeMinutes` | no | How many minutes ahead a guest's slot must be. Staff are never held to it. |
| `resource` | no | A column (a table, a room): the limit applies per value of it too. |
| `cancelHours` | no | Until how many hours before its time a guest may still cancel through the public API. Staff are never held to it. |
| `hold` | no | Rows count only while their hold lasts; see [Holds](#holds). |

The slots of a day run on the grid from opening. With an `hours` table the day is
`[opens, closes)`: the last slot starts before closing. With plain `opens` and `closes`, a slot
also ends by closing.

#### Parent limits

```json
"capacity": {
  "kind": "parent", "via": "ticket_type_id",
  "size": { "column": "quantity" },
  "countWhere": [{ "column": "status", "values": ["valid", "offered", "checked_in"] },
                 { "column": "status", "values": ["held", "paid"], "via": "order_id" }],
  "window": { "opens": "sales_open_at", "closes": "sales_close_at" },
  "perWrite": { "max": 6, "within": "order_id" },
  "also": [{ "via": "event_id", "size": { "column": "sell_limit" } }],
  "hold": { "column": "held_until", "states": ["held"], "via": "order_id" }
}
```

| Field | Required | Rule |
|---|---|---|
| `kind` | yes | `"parent"`. |
| `via` | yes | The foreign key to the row holding the limit. A row with it empty is left out of this rule. |
| `size` | yes | How many the pool holds: a number, a settings reference, or `{ "column" }`, a number column of the row `via` points at (empty there: no limit). With `{ "column", "onDay" }`, `onDay` a `date` column of that row, the number holds only on that venue day and any other day has no limit (today's portions); it needs `day`. |
| `amount` | no | How much a row takes: an `int` column of the row, or a number. Absent: one. |
| `countWhere` | no | Which rows count (above). |
| `window` | no | `{ "opens"?, "closes"? }`: `timestamptz` columns of the parent a sale must fall between (empty: no bound). |
| `perWrite` | no | `{ "max", "within" }`: at most `max` (a size, as above) per row of `within`, a foreign key of this row (up to six tickets an order). |
| `also` | no | 1–2 wider pools the same rows also take from: `{ "via", "size" }`, where `via` is another foreign key of the row and `size` a size of the row it points at, or `{ "via", "column" }` one more hop away (a room's cap across its ticket types). |
| `day` | no | Count only the rows of the same venue day as this time: a `timestamptz` column, or `{ "column", "via"? }` on the owner. |
| `lockBy` | no | The column whose value names the lock: `via`, or a wider pool's `via` that is itself a `copy` through `via`. Absent: one lock for the whole table. |
| `hold` | no | See [Holds](#holds). |
| `reserved` | no | `{ "states", "via"? }`: counted states whose places are kept back from the public while staff decide what to do with them (a refunded ticket held for the waitlist). Not a held state. |

#### Night limits

```json
"capacity": [{
  "kind": "night", "from": "arrive", "to": "depart",
  "countWhere": { "column": "status", "values": ["booked", "in_house"] },
  "pool": { "via": "room_type_id",
            "count": { "table": "rooms", "column": "room_type_id",
                       "outOfService": { "table": "room_blocks", "room": "room_id", "from": "from_date", "to": "to_date", "active": "active" } },
            "fits": { "column": "sleeps" },
            "given": { "via": "room_id", "column": "room_type_id" } },
  "nights": { "min": 1, "max": 28, "aheadDays": 365 },
  "arrived": { "states": ["in_house"] }
}]
```

A stay takes one unit on every night from its arrival to the day before it leaves.

| Field | Required | Rule |
|---|---|---|
| `kind` | yes | `"night"`. |
| `from`, `to` | yes | The arrival and the departure: `date` columns of the row, or `{ "via", "column" }` of the row it belongs to (an extra's nights are its stay's). |
| `countWhere` | no | Which rows count (above). |
| `pool` | yes | Either the rows of another table: `{ "via", "count": { "table", "column", "outOfService"? }, "fits"?, "given"? }`, the rows of `count.table` whose `column` points where the row's `via` points (the rooms of a type); or one unit per row pointed at, or a number of that row: `{ "via", "size": 1 or { "column" }, "outOfService"? }` (a room holds one stay a night; an extra's parking spaces). |
| `pool.count.outOfService`, `pool.outOfService` | no | `{ "table", "room", "from", "to", "active"? }`: rooms out of service between two dates, `room` a foreign key to the counted rows. They are taken off the pool on those nights. |
| `pool.fits` | no | `{ "column" }`: a number column of the pool's row a stay's guests must fit (how many a type sleeps). It filters what [availability](#availability) offers; to refuse a stay with too many guests, use the entry's [`agrees`](#a-create-with-its-child-rows). |
| `pool.given` | no | `{ "via", "column" }`: when the row's `via` link is set (a room given), it counts against that row's `column` instead (the room's type, not the one booked). |
| `nights` | no | `{ "min"?, "max"?, "minByArrival"?, "aheadDays"? }`: the shortest and longest stay (a stay is at least one night), a shortest stay per arrival weekday (`{ "fri": 2 }`, 1–60), and how many days ahead a stay may start. |
| `hold` | no | See [Holds](#holds). |
| `arrived` | no | `{ "states", "via"? }`: the counted states of a stay whose guest has arrived. A change of such a stay (another room, another type, other dates) is judged from the venue's today on; the nights already slept are never judged again, so a room closed last night takes nothing from a guest moved today. Extras whose nights come from the stay are judged the same way. |

Parent and night availability for guests read the pool's rows, so the key also needs a plain
read entry on the pool's table (the ticket types, the room types).

#### Holds

A **hold** makes a row count only for a while: an order a guest is paying for keeps its tickets
for ten minutes, and gives them back when it lapses.

```json
"hold": { "column": "held_until", "states": ["held"] }
```

| Field | Rule |
|---|---|
| `column` | When the hold ends: a `timestamptz` column of the row (or of its owner, with `via`) that a [stamp](#stamps) writes, never one a guest writes. Or `{ "column", "via", "or"? }`: a moment of a linked row, `via` a foreign key of the row the hold reads, and `or` 1–2 fallbacks `{ "column", "via"? }` read when the link is empty (a waitlist offer's end, else the order's own). |
| `states` | 1–8 counted states in which the row is held. A row in one of them counts only until its hold ends; a row in any other counted state counts whatever its old hold says (a paid order). |
| `via` | The owner the states and the column are read on. |

One live hold per buyer. A public create sends `replaces`, the page's own-link session for the
hold it takes the place of (a checkout changed before it was confirmed): that hold is let go in the
same write, and the session moves to the new hold. A verified signed-in person's other holds are
let go the same way. A [dry run](#dry-runs-price-checks-and-retries) takes `replaces` too, and
judges the places as if the old hold were gone, letting nothing go. Letting a hold go writes its
end directly, with no rule run on that write, so nothing may watch a hold's end column: no stamp,
code renewal or followed copy is set off by it.

A row that leaves a hold state (a waitlist claim) counts the places kept back by `reserved` as
staff do, so a returned place offered on is not counted twice.

#### How a limit is judged

A write that adds to what a pool counts is judged inside its transaction, under a named lock (a
slot limit's per venue day, a parent limit's per `lockBy` value, a night limit's per table), so two
writers never both take the last place. A writer waits at most 10 seconds for another's lock, then
is answered `409` `CAPACITY_BUSY` (or `NUMBER_BUSY`) to try again. A bulk edit cannot move a row
whose limit needs a lock (`409` `CONFLICT`, `details.reason: "CAPACITY_ONE_AT_A_TIME"`), nor can a
public batch (`400` `PUBLIC_WRITE_REFUSED`); an import records history, and is not judged.

Staff are refused `409` `CAPACITY_FULL`, with `details` naming the rule's kind, the column, the
pool (`key`, `at`) and `left`, the places that were left before the write; a place the venue does
not offer is refused with a reason (out of range, out of hours, closed, paused, not on sale, too
many). A guest is told `PUBLIC_SLOT_FULL`, `PUBLIC_SOLD_OUT` or
`PUBLIC_NO_ROOM` (with the `night`), never how full anything is; see
[Error codes](/reference/errors/). Sample rows count against real availability like any other.
For the whole picture, see [Booking rules and limits](/guides/apps/booking-rules/).

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
| `moves` | yes | From each state, up to 16 states a row may move to. A move is a state (`"void"`), or `{ "to", "requires"?, "roles"?, "undo"?, "clears"? }`. A move goes to another state. `undo: true` marks a move that takes back the listed move the other way; `clears` (1–8 columns, on an undo only) names further columns it empties. See [Undo of a move](#undo-of-a-move). |
| `lock` | no | `{ "when", "except"? }`. While a row is in one of `when` (1–16 states), only the columns in `except` (up to 32) may change, and the state itself through a move. The state column is never in `except`. |
| `children` | no | Child tables tied to the row's state, keyed by table ref. See below. |
| `lockedWhenReferencedBy` | no | 1–4 `{ "table", "via", "in" }`: the row is locked once a row of `table`, whose foreign key `via` points at it, is in one of the states `in` (a terms version, once a proposal naming it is sent). Needs `lock`, which says what stays open. |
| `noDelete` | no | `{ "when" }`: rows that are never deleted, only voided. `when` is 1–16 states, or `"numbered"`: any row that holds a number from a [gapless sequence](#numbers-without-gaps). `"numbered"` needs such a column on the table. |
| `onlyLater` | no | 1–8 `date` or `timestamptz` columns that may move later, never earlier (a quote's `valid_until`). An entry `{ "column": "depart", "in": ["in_house"] }` holds only while the row is in one of `in` (a stay in the house leaves no earlier by a change of its date). |
| `strict` | no | `true`, or `{ "show": [1–4 columns] }`: a write naming the state the row already holds is refused rather than passing silently (a ticket let in once). See [Once means once](#once-means-once). |
| `late` | no | 1–4 moves judged late when made close to a moment; see [Late moves](#late-moves). |
| `timed` | no | 1–8 moves Adminium makes by itself once a moment has passed; see [Timed moves](#timed-moves). |
| `effects` | no | 1–8 moves of the row a link points at, set off by this row's move or by a change of the link; see [Effects](#effects). |
| `create` | no | `{ "requires" }`: what a new row must meet to be created; see [Conditions on a new row](#conditions-on-a-new-row). |

A move's `requires` says what must be true first:

| Field | Rule |
|---|---|
| `children` | `{ "<table>": n }`: at least `n` (1–1000) rows of a child table. The table must be one of `children`. |
| `where` | 1–8 conditions on the row itself: `{ "column", <one test> }`, where the test is `eq` or `in` (values that fit the column), `isNull` (`true` or `false`), or `gt`, `gte`, `lt` or `lte` (a number, on a number column). |
| `linked` | 1–4 `{ "via", "where" }`: conditions (as `where`) on the row this row's foreign key `via` points at (the order a ticket belongs to is paid). |
| `time` | `{ "after"?, "before"? }`: a window on the clock, each end a [moment](#moments) (from half an hour before the doors, until the ticket's day ends). |
| `setting` | 1–4 `{ "table", "column", "eq" }`: a value of the settings row (door sales switched on). |

A move's `roles` (1–8 of the app's [role](#roles) keys) keeps it for the people holding one of
them: any role may void a draft, only a manager a sent invoice.

Each entry of `children` names a child table whose foreign key `via` points at this table, with at
least one of:

| Field | Rule |
|---|---|
| `lock` | `true`: the child's rows are locked while this row is. Needs a `lock` on this table. |
| `parentIn` | 1–16 states: the child's rows may be written only while this row is in one of them (payments on a sent invoice). Not with `lock`. It is `createIn` and `changeIn` at once. |
| `createIn` | 1–16 states: a child row may be **added** only while this row is in one of them (a payment taken on a stay still booked or in house). Not with `lock` or `parentIn`. |
| `changeIn` | 1–16 states: a child row may be **changed or deleted** only while this row is in one of them (a payment voided on a cancelled stay too). Not with `lock` or `parentIn`. |
| `clearOnCreate` | 1–8 nullable columns of **this** row, emptied when a child row is created (a recorded payment clears the client's "I've sent it"). |
| `lockLinked` | `{ "<link>": ["<column>", …] }`: for 1–8 of the child's foreign keys to other tables, 1–16 columns of the row the link points at that do not change while a child row points at it (the hours of time an invoice line bills). The key is never one. |

and, with `lock`:

| Field | Rule |
|---|---|
| `release` | `{ "when", "columns" }`: while this row is in one of `when` (states the `lock` holds, and that no move leaves), a child row may still **empty** the listed columns (1–8 nullable columns of the child, never `via` or the key), and change nothing else. A released state must be final: a released link stops locking the row it points at, so a document that could move on would bring its line back billing a row that changed meanwhile. |

Time and purchases billed on invoice lines, so that nothing is billed twice (each link `unique`),
and billed again once the invoice is void:

```json
"children": {
  "invoice_lines": {
    "via": "invoice_id", "lock": true,
    "release": { "when": ["void"], "columns": ["time_entry_id", "expense_id"] },
    "lockLinked": {
      "time_entry_id": ["hours", "logged_hours", "project_id", "date"],
      "expense_id": ["amount", "currency", "project_id", "client_id"]
    }
  }
}
```

A void invoice's line may set `time_entry_id` to `null`; setting it to another entry, changing
anything else on the line, or deleting it stays `RECORD_LOCKED`, and so does emptying it while the
invoice is sent. While a line points at an entry, a change to one of the entry's listed columns is
refused `409` `RECORD_LOCKED`, `details.column` naming it, and the entry's record page draws those
fields read-only. A line on an invoice in a state that releases its link (`release.when`, with the
link among `release.columns`) keeps nothing: once the invoice is void the hours may change, and
once the line lets go the time may go on another invoice. A line whose invoice is gone, or has no
state, keeps them. A value the line copies from the entry (a `copy` through the link) is read
again when the line is written, holding the entry: an entry changed in between refuses the line
`409` `WRITE_CONFLICT`, to be written again, so a line never bills hours its entry no longer has.
A listed column Adminium works out (a formula) is kept too: a change to what it is worked out from
is refused naming it. A total over the entry's own child rows (a rollup) is Adminium's, and moves.

A `lockLinked` link is followed through its foreign key. Studio refuses to save states whose link
has none, or names a column the linked table does not have. If the link later stops leading
anywhere Adminium can read (its relation removed in Studio, its foreign key or a kept column
dropped), the rule fails closed: a line may no longer be linked through it, and creating one or
changing its link is refused `409` `RECORD_LOCKED` with `details.unresolved: true` and the link as
`details.column`. Emptying the link, and every other change to the line, still goes through, and
the columns that can still be followed stay kept. Put the relation back, or change the states in
Studio, to bill through it again. A refusal names tables by their own names (`linkedFrom`,
`parent`), never with a schema in front.

A move that is not listed is not one the row may make. Columns Adminium keeps (totals, balances,
formulas, stamps) are Adminium's to write whatever the state. A new row starts in `initial`. A
locked row cannot be deleted either, with or without `noDelete`.

The states hold on every write to the table: a form, a bulk edit, an automation, the public API,
and an outbox's `onSent` change. A refusal is `409`: `STATE_MOVE_REFUSED` for a move the row may
not make (or a new row that does not start in `initial`), `RECORD_LOCKED` for a change to a locked
row or to a child row its parent's state does not allow (`details.on` says `create` or `change`,
beside the parent's `state` and the states that allow it), and `DELETE_REFUSED` for a delete. An
`onlyLater` column moved earlier, or emptied, is refused `422` with the code `out-of-range`.
Through the public API each of these is `PUBLIC_WRITE_REFUSED`.

Adding sample data and importing past records are history. A new row they write may start in
any state, and a child row may follow a parent the same import or sample brought in; a child
row under a parent that was already there is judged as any other write. An import that updates
a row already there is judged in full, and a history write empties no `clearOnCreate` column.
An undo is never given for a write to a table with states, or to its child tables: a mistake is
moved on (voided, sent back), never unwritten. The one exception is a status move the app lists an
[undo move](#undo-of-a-move) for: its Undo is that move back, judged like any move. A table whose
columns a `lockLinked` keeps keeps its undo, and an undo is judged like any other change: an edit
of the hours made before the time was billed is not taken back after.

#### Conditions a move waits for

Beyond `children` and `where`, a move may wait for the row one of its links points at, for a window
on the clock, and for the settings row:

```json
"moves": {
  "valid": [{ "to": "checked_in",
              "requires": { "linked": [{ "via": "order_id", "where": [{ "column": "status", "eq": "paid" }] }],
                            "time": { "after": { "column": "doors_at", "via": "event_id", "minus": { "minutes": 30 } } },
                            "setting": [{ "table": "settings", "column": "door_open", "eq": true }] } }]
}
```

Everything is read inside the write's transaction, holding the linked row, so a ticket scanned
while its order is being paid sees the order as it committed. A condition that cannot be read (an
empty link, a linked row that is gone, a moment with no value) refuses: a move waiting for
something is never let through on nothing. A link that another writer moved while the write was
waiting refuses `409` `WRITE_CONFLICT` (`details.retry: true`). The window is judged by the
write's own clock, or by the time a staff device says a scan was made (`occurredAt`). A refused
move is `409` `STATE_MOVE_REFUSED`, its `details` naming what failed: `requires` (`linked`,
`time` or `setting`), and `via`, `column`, `bound` (`after` or `before`) and `at` where they
apply, so the door can say "Not paid yet", "Not today" or "Too early".

#### Conditions on a new row

`create` holds a new row to the same conditions before it is created at all: a check-in recorded
only for a paid ticket, on its day, from half an hour before the doors.

```json
"create": { "requires": {
  "linked": [{ "via": "ticket_id", "where": [{ "column": "status", "in": ["valid", "offered"] }] }],
  "time": { "after": { "column": "doors_at", "via": "event_id", "minus": { "minutes": 30 } } } } }
```

`requires` takes `where`, `linked`, `time` and `setting`, at least one, in the shapes above (no
`children`). They are judged inside the create's transaction on every door but an import, which
is history; a staff device's `occurredAt` stands in for now. A refusal is `409`
`STATE_MOVE_REFUSED` with `details.create: true` and `from: null`, beside `to`, `requires` and
the parts above. The row's formulas are worked out before the conditions are judged.

#### Once means once

`strict` refuses a write that names the state the row already holds, rather than letting it pass:
a ticket let in once is not let in again. The refusal is `409` `STATE_UNCHANGED`, with `details.at`
and `details.by`, when and by whom the row got there. `{ "show": [...] }` repeats up to 4 more
columns of the row in the refusal (the door it came in by); never a secret or personal one.
Through the public API it is `PUBLIC_WRITE_REFUSED` with `reason: "unchanged"`. A parent form that
sends a child row's unchanged state back is not refused.

#### Late moves

`late` judges a move made close to a moment: a cancellation inside the last 48 hours before a
stay's arrival.

```json
"late": [{ "to": "cancelled", "from": ["booked"], "moment": { "column": "arrive", "time": "15:00" },
           "within": { "hours": 48 }, "mode": "flag", "flag": "late_cancel" }]
```

| Field | Rule |
|---|---|
| `to` | The state moved to. Each late rule judges its own move; a move the [booking](#booking) rule's `cancel` already judges takes no second one. |
| `from` | 1–16 states the move comes from, each a listed move to `to`. Absent: any. |
| `moment` | The [moment](#moments) it is close to, read from the row as stored: a guest who types a later arrival in the same change does not move the window. |
| `within` | How close: one of `minutes`, `hours` or `days`, a number or a setting. A moment already past is inside the window too. |
| `mode` | `"flag"`: the move goes through and sets `flag`, a bool column of the table no other rule writes, whoever writes. `"refuse"`: the move is turned away, for a public writer, or with `"refuse": "everyone"` for every writer. |
| `where` | 1–8 [conditions](#conditions-a-move-waits-for) on the row as the write leaves it. Only a move that meets them is judged: `[{ "column": "cancel_code", "in": ["guest", "no_card"] }]` leaves a cancellation by the house out, even inside the window. A flag sent for a move the `where` leaves out is dropped. |

A refused late move is `409` `STATE_TOO_LATE` for staff, and `PUBLIC_TOO_LATE` through the public
API.

#### Timed moves

`timed` lists moves Adminium makes by itself once a moment of the row has passed: an order still
held when its hold ends is released, an order still placed at the kitchen's closing hour is
cancelled.

```json
"timed": [{ "from": "placed", "to": "cancelled",
            "at": { "column": "pickup_at", "time": { "hours": { "table": "opening_hours", "weekday": "weekday", "open": "open", "opens": "opens", "closes": "closes" }, "edge": "closes" } },
            "set": { "cancel_code": "closed" } }]
```

| Field | Rule |
|---|---|
| `from`, `to` | A listed move, never one marked `undo`. One timed move leaves each state. |
| `at` | A [moment](#moments) of the row's own columns (no `via`). A move whose `requires.time.after` is certainly later than `at` could never be made in time, and is refused by the validator. |
| `set` | 1–8 other columns of the row and the fixed value (or `null` on a nullable column) the move writes with it: why an order still open at closing was cancelled. Never the state column, the key, or a column another rule writes. |

A timed move is a write by Adminium like any other: it is judged as the declared move (its
conditions, limits and totals), and sets off stamps, code renewals, effects and emails. See [Timed moves on the venue's clock](/guides/apps/timed-moves/).

#### Effects

An effect moves the row one of this row's links points at, in the same write: a guest checked out
turns the room to cleaning.

```json
"effects": [
  { "on": { "to": "in_house" }, "via": "room_id", "set": { "status": "occupied" } },
  { "on": { "to": "departed" }, "via": "room_id", "set": { "status": "cleaning" } },
  { "on": { "change": "room_id", "in": ["in_house"] },
    "old": { "set": { "status": "cleaning" } }, "new": { "set": { "status": "occupied" } } }
]
```

There are two kinds, up to 8 effects a table:

- **On a move** (`on.to`): when this row moves to the state, the row `via` points at moves to the
  state `set` names. At most one such effect per state and link.
- **On a changed link** (`on.change`, a foreign key): when the link really changes while the row
  is in one of `on.in` (before and after the write; absent: any state), the row it pointed at
  moves by `old` and the row it now points at by `new`; either may be left out. A link first set
  or emptied moves only the side there is. One such effect per link. Without `in`, a booked
  guest's room assignment would flip rooms too; a hotel says `in: ["in_house"]`.

`set` names one column, the linked table's state column, and a state one of its listed moves goes
to. The linked row is moved by that declared move and judged as it: its conditions, the limits and
totals it moves, its own states. A row already in the state an effect's `old` side names is left as
it is; a new row already in the state `new` names refuses the whole write (`409`
`STATE_MOVE_REFUSED` with `details.effect: "new"`: the new room is not ready). Any refusal refuses
the whole write.

An effect moves one row, one link away, never a chain. The linked table may not be one whose rows
are lines of another table's states, one that books people by the day, the app's outbox, or one
whose rows set off effects of their own; and the move it makes may not wait for another row, be an
undo, or be judged late by another row's time. A table a project hook watches is refused at run
time. History (an import, sample data) sets off no effect. A move that set off an effect offers no
Undo.

#### Undo of a move

A move marked `"undo": true` takes back the listed move the other way: the kitchen marked an
order ready by mistake, and moves it back to preparing.

```json
"moves": {
  "preparing": ["ready"],
  "ready": [{ "to": "preparing", "undo": true,
              "requires": { "time": { "before": { "column": "ready_at", "plus": { "minutes": 1 } } } } }]
}
```

An undo move is made only by a write that names the state it saw the row in (`from` on a staff
change): a stale screen's tap never takes back another screen's move, and is refused `409`
`STATE_MOVE_REFUSED` naming both states. What it waits for is judged on the row as it stands. The
stamps written when the row entered the state it returns to keep what they had; the stamps marked
[`clearOnBack`](#stamps) that watch the state it leaves are emptied. A state reached only by undo
moves is never written by a door that names no state it saw: a timed move, an effect, an email's
`onSent`, or a value a guest may write. An outbox producer with [`holdSeconds`](#outbox) waits long
enough for an undo to drop its message.

An undo may empty further columns that the move it takes back filled, with `clears`: a hand-over
taken back is unpaid again.

```json
"moves": {
  "ready": [{ "to": "picked_up", "requires": { "where": [{ "column": "paid_method", "isNull": false }] } }],
  "picked_up": [{ "to": "ready", "roles": ["manager"], "undo": true, "clears": ["paid_method"] }]
},
"lock": { "when": ["picked_up"], "except": ["link_stopped"] }
```

- The move empties each column it `clears`, whether or not the writer sends it. A writer may leave
  it out or send it as `null`; a value is refused `409` `STATE_MOVE_REFUSED`, with
  `details.clears` naming the column, and nothing is written.
- What an undo empties, its `clearOnBack` stamps and its `clears`, is open to the table's `lock`
  for that move only, and only to be emptied. The same column changed by any other write stays
  locked (`409` `RECORD_LOCKED`). The lock's other columns and the rows of `children` tied to it
  stay as they are.
- `clears` names 1–8 columns of the table, each once, that may be empty. It never names the state
  column, the key, or a column another rule writes (a stamp is emptied by `clearOnBack` instead).
  It is refused on a move not marked `undo`: `only a move marked undo empties columns as it goes`.
  A states rule saved in Studio is held to the same checks.
- A move is taken by its target: the first listed from a state to another is the one made. A
  second move between the same two states is refused when either is marked `undo` or names
  `clears`: `another move from "picked_up" to "ready" comes first, so this one is never made`.
- The dashboard's Undo of the forward move makes this move back when the forward change filled
  a column the undo `clears` from empty. When the change overwrote a value already there, the move
  back would lose it, so no Undo is offered. Nor is one offered to a person who holds none of the
  move back's `roles`.
- A take-back whose row was moved back and on again by someone else while it was made is refused
  `409` `WRITE_CONFLICT` with `details.retry: true`: make it again.

A code nothing renews is put back by an undo as it was. A code a change of hands renewed is never
put back: undoing the hand-over makes a code neither holder had. See
[Undo a status move](/guides/apps/undo-a-status-move/).

### Shared tables

Two apps may use one table between them: a restaurant's point of sale and its online ordering
read and write the same menu. Each app declares the table with the same `shape`, a name and a
version (`"shape": "menu@1"`); the second app's install plan finds the first app's table and
offers to share it (the **Shared** case in [What the plan does with each
table](#what-the-plan-does-with-each-table)), with the same safe changes it would make to a table
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

A shared table's real rows are the venue's: the second app's [sample data](#sample-data) can leave
its demo rows for it out (`skipWhenShared`). A table has `shape` or [`builtOn`](#tables-built-on-an-add-ons-shape),
never both. See [A menu two apps share](/guides/apps/shared-menu/).

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
  `validation`, `required`, `requiredWhen`, `options`, `notAfter` and `notBefore`;
- a `copy` in front of a column the part fills with a `default` (a client's own tax rate before the
  add-on's default rate): the part's default still answers when the copy comes back empty;
- in the states: more `lock.except` columns (its own columns that stay writable), `roles` on a
  move, more tables in `children`, more columns in a child's `clearOnCreate`, and on a child the
  part ties to the state a `release` and `lockLinked` entries naming only columns the app added
  to that child (a line's own `time_entry_id`), never the part's. A `release` the part has is
  kept as it is, and a `lockLinked` entry it has keeps at least its columns.

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
| `limits` | no | Per table ref, what the role's `update` there may change, and what its `read` there shows. See below. |

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
| `writable` | no | The columns the update may change, at least one. |
| `writableValues` | no | For a column in `writable`, the only values it may set (1–32, each a value of the column). Needs `writable`. |
| `readable` | no | The only columns the role's read of the table shows, 1–200, each once. The key and the table's links to other rows are always read. Needs the role's `table:@<ref>:read`. |
| `creatable` | no | The only columns a new row the role creates may be given; the rest take their defaults or what Adminium decides. Needs the role's `table:@<ref>:create`. |
| `creatableValues` | no | For a column in `creatable`, the only values a new row may be given (1–32). Needs `creatable`. |

A limit names `writable`, `readable`, `creatable`, or any of them.

The table must be one the app declares, and the role must grant `table:@<ref>:update` itself or
through `cloneFrom`. Someone who also holds a role with an unlimited update on the table is not
limited. Creating rows is not limited by `writable`; `creatable` limits it the same way, on the
create itself, a row added from a parent's form, and an import (which may not bring in a column
outside `creatable`, nor one whose values are limited). A value left empty, and the state column at
its first state, are no choice and always pass. Every install and update writes the
manifest's current limits. See [Edits limited to some columns](/guides/apps/roles-and-staff-access/#edits-limited-to-some-columns).

`readable` limits what the role **reads** the same way: housekeeping reads a stay's room and dates,
and none of its guest or its money.

```json
"limits": { "stays": { "readable": ["room_id", "arrive", "depart", "late_checkout", "status"] } }
```

Every staff read of the table holds to it: lists and records, links and lookups, search, exports,
imports, dashboard cards and their live updates, documents, the audit log, files kept in a hidden
column, and the page assistant. Selecting, filtering or sorting by a hidden column is refused `403`
`COLUMN_FORBIDDEN` with `details.reason: "read-limit"`; a lookup into one reads as masked. A
refusal never repeats a hidden value, and the desk's limit counts and nightly lines are refused
when the rule reads a hidden column. A hidden column is not written through the role either,
creates included, unless `writable` names it. Roles add up: two limited roles read the union of
their columns, one unlimited read of the table reads it all, and a Super Admin is never limited.

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
| `requestValues` | no | 1–8 slots the app's own screen may fill when it asks for the document (a label sheet's `count`). Each must be a slot the entry does not map; when the add-on is attached, its outline must have the slot, with no default, holding a number or a text. See below. |
| `where` | no | `{ "column", "in": [...] }`: only rows whose column holds one of 1–16 values have this document (a `receipt` for `payments.kind` `taken`, not for money given back). Asked for another row, the render answers `409` `DOCUMENT_NOT_FOR_ROW`; an email that would carry it goes without it. |

The slots are the add-on's words (`number`, `issuedAt`, `items`): a shape's own profiles, in the
add-on's manifest, show the ones it draws. Each slot reads one of:

| Source | Reads |
|---|---|
| `{ "column", "form"? }` | A column of the row. |
| `{ "via", "column", "form"? }` | A column of the row a foreign key `via` of this table points at: the client's name on an invoice. |
| `{ "collection": { "table", "via", "orderBy"?, "columns", "where"?, "unless"? } }` | A list of child rows, whose foreign key `via` points at this table, in `orderBy` order. `columns` maps the add-on's names for a line's values to the child's columns. `where` (`{ "column", "in": [1–16 values] }`) keeps only the rows whose column holds one of the values; a row whose `unless` column is true or set is left out (a voided line). |
| `{ "collection": { "nightly", "columns" } }` | The nights a [price by the night](#prices-by-the-night) of the row is made of, one line each, worked out when the document is drawn. `nightly` names the priced column; `columns` maps a line's values to a night's own `date`, `rate`, `base`, `qty` and `tags`, or to `<rate via>.<column>`, a column of the row the rate comes from (`room_type_id.name`). |
| `{ "collections": [1–4 sources] }` | One list from several sources, in order, each a table source or a nightly source as above: a folio's nights, then its extras, then its charges. |

A line's value in a table source may also be a list of names one level below the line, printed one
after another (a dish's options, "Farro · Grilled chicken · Avocado"):
`{ "list": { "table", "via", "column", "orderBy"? } }`, where `column` is a `text` or `enum` column
of the rows whose `via` points at the line. Such a list never names a secret, personal, code or
withheld column. `"form": "grouped"` prints a [code](#column-rules) column in groups of four
(`K7QX-M2PD`), as a person reads it out; only on a code column.

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
`POST /api/v1/apps/<key>/documents/render` with `{ "kind", "ref", "pk", "period"?, "locale"?, "values"? }`,
where `ref` is the table's short ref and `pk` the row's key. `values` fills the slots the entry
lists in `requestValues`, by slot id, typed by the add-on's outline (`{ "count": 12 }`); a value for
any other slot, for one a value typed into the profile fills, or one its type cannot hold is `400`
`DOCUMENT_VALUE_REFUSED`, naming the slot, and nothing is drawn. A document drawn with values
lists the slots they filled under `requestValues` in its subject, is never emailed on its own
(`pending-review`, as a stranger's is), and a later draw of the same row takes nothing from it. The document is drawn now, or the one
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
| `columns` | yes | The outbox's columns. `kind` is an enum of the kinds. `status` is an enum holding at least `queued`, `sent`, `failed` and `skipped`, and `held` when a producer holds. `to` is `text`, the address. Optional: `language` (`text`), `due` (`timestamptz`, required by a `before` producer and by one with `hold` or `due`), `sentAt` (`timestamptz`) and `error` (`text`), and the columns of [held messages](#held-messages): `skipReason` (`text` or `enum`), `subjectOverride`, `bodyOverride`, `approvedBy` and `effectError` (`text`), and `effectAt` (`timestamptz`). `repeatKey` (`text` of at least 43 characters) keeps which value a `repeatBy` producer sent for; `was` (`text`, unbounded or at least 1000 characters) keeps a `was` producer's values from before the change. |
| `links` | no | The outbox's foreign keys, by the name a template reads them under: `{ "appointment": "appointment_id" }` gives a template `appointment.*`. Names are snake_case. Every foreign key of the outbox table that the outbox names must be nullable: not every email is about one. |
| `recipient` | yes | Who the email goes to. See below. |
| `settings` | no | The app's one-row settings table: `{ "table", "enabled"?, "name"?, "phone"? }`. Templates read it as `practice.*`. `enabled` is a bool that pauses producers with `gate: "enabled"`. `name` is a `text` column the app's emails are signed with, the [emailed code](#public-access) included; without it, the workspace's name is used. `phone` is a `text` column: when it holds a number, the notice sent to a person's old address after a change of email tells them to ring it; without one, the notice says to contact you. `replyTo` is a `text` column: when it holds one plain address, every message the app sends carries it as its Reply-To, so a guest's reply reaches the house rather than the no-reply sender; empty, or anything but one address, adds none. |
| `pages` | no | `{ "manage"?, "booking"? }`: paths on the app's customer side (`/my-visits`) that a template's `manage_url` and `booking_url` lead to. Up to 120 characters. Default: the side's front page. |
| `kinds` | yes | Each value of the kind column, and the key of the template it is sent with. Every value must be one of the enum's, and every template one of `emailTemplates`. |
| `producers` | no | Up to 24 rules that queue rows by themselves. See below. |

**`recipient`** is `{ "via", "table", "email", "name"?, "language"?, "optIn"?, "fallback"? }`.
`via` is the outbox's foreign key to the person, `table` the person's table, and the rest are its
columns: `email`, `name` and `language` are `text`, and `optIn` is a bool the person sets (false
means nothing from a producer that asks `optIn`). `language` may instead be `{ "column" }`, a `text`
column of the row the message is about: an order placed in German is written to in German, whatever
the person's own row says. The row every producer's message is about must have that column. It is
used only when it holds one usable language tag that fits the outbox's `language` column (which
must be named); otherwise the person's language is. `fallback` is `{ "via", "email", "name"?, "language"? }`: where the address
comes from when `via` is empty. Its `via` is another foreign key of the outbox, and its columns
belong to the table that key points at; a first visit by someone not yet on file carries their
details on the visit itself.

**Producers.** Each has a `kind` (a key of `kinds`) and a `link`, the outbox's foreign-key column
that points at the row the message is about and must be one of `links`. Optionally `gate` and
`optIn: true` (needs `recipient.optIn`: a person who opted out gets nothing). `gate: "enabled"`
pauses the producer while the settings row's `settings.enabled` bool is false;
`gate: { "setting": { "table", "column" } }` pauses it while that bool of the settings row is false,
so each notice can have its own switch; `gate: { "feature": "<id>" }` sends only while one of the
app's [`addOns.features`](#add-ons) is on (a receipt, while Invoices & Receipts is attached);
`gate: { "feature": "<id>", "setting": { "table", "column" } }` queues only while both hold: the
feature is on AND that bool of the settings row is true (a receipt, while Invoices & Receipts is
attached and the manager's switch is on). Each half is checked as it is alone. Every gate is judged
when the message is queued: a message already waiting (held, or due later) still goes when the
gate closes after it was queued, unless its `dropWhen` drops it. A message of the kind sent from a
[new link](#a-rows-own-link) or a "Send it again" is judged by the same gate, and a kind held for
approval (`hold: true`) cannot be sent from a link at all. Then exactly one of:

| Producer | Shape | Queues a row |
|---|---|---|
| `onCreate` | `{ "table", "via"?, "where"? }` | When a row of the table is created. |
| `onChange` | `{ "table", "via"?, "column", "to", "where"? }` | When the column changes to `to`, a value or a list of 1–16 values. |
| `onChange` | `{ "table", "via"?, "columns", "changed": true, "where"? }` | When any of 1–8 columns changes, compared with the row as it was stored (a stay's dates, whatever they became). Numbers compare as numbers and dates by day. |
| `before` | `{ "table", "at", "lead", "where"? }` | A lead time before `at`, a `timestamptz` of the row: a reminder. `lead.at` (`"HH:MM"`) sends it at that wall time on the venue's day the lead reaches: 24 hours before a 20:00 show, at 09:00, is 09:00 the day before. |

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
| `recipient` | `{ "setting" }`: send to the address a setting holds (a studio's own `reply_to`), never to the person the row links. The setting is `{ "table", "column" }` of the settings row, or `{ "addOn", "setting" }` of a required add-on. Or `{ "column", "name"?, "language"? }`: send to the address a `text` column of the producing row holds (the friend a ticket is offered to), with that row's `name` column as the name and its `language` column as the message's language. |
| `holdSeconds` | 1–3600: the message waits this many seconds before it may go, so a move taken back at once (an order marked ready by mistake) drops it by `dropWhen` before anyone is told. A message dropped so does not stop the next one of its kind. Needs the outbox's `due` column; not on a `before` producer, nor with `hold`, `due` or `batchMinutes`. |
| `repeatBy` | A column of the row the message is about: one message for each value it holds, not one for the row for ever (a ticket offered again, its link made afresh, is emailed again). A message for an earlier value not yet sent is skipped as overtaken. Needs the outbox's `repeatKey` column; not on a `before` producer, nor with `batchMinutes`. |
| `repeat` | `true`: one message for each change it hears of, not one for the row for ever ("Resend tickets" twice is two messages). Only on an `onChange` producer, and not with `repeatBy` or `batchMinutes`. |
| `was` | 1–8 columns of the changed row kept as they were before the change (a stay's old dates, its old total), read by the template as `{{was.<column>}}` in every form the column has. Only on an `onChange` producer; needs the outbox's `was` column. Never a secret, personal, code, share-code, withheld or typed-code column. |
| `batchMinutes` | 1–240: one message per linked row in each window of this many minutes. The first event opens a message due at the window's end; every event while it still waits is taken in by it (five versions posted in ten minutes make one email). The window's end is its due, so it takes no `due`; it may still be dropped (`dropWhen`) or overtaken (`supersede`) while it waits. Not on a `before` producer. |
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

A source row produces each kind once, unless its producer says `repeat` or `repeatBy`. A reminder
is produced again only when its moment moves; a batched message, once its window has closed. An
undo of a change is heard by the producers of `"changed": true` alone, so the dates it puts back are
mailed; a `{ "column", "to" }` producer never fires on an undo. Sample data and imports fire no
producer when they are written. A sample row never has a message at all. An imported row is a real one, so the
minute's look-over still makes its `before` reminder when the moment comes, and a held producer's
messages for it (an imported sent invoice gets its reminders).

A message row an import or an undo brings back never goes by itself: nothing here made it and
nobody approved it. One that arrives `queued` comes in `held` for a person to approve, or `failed`
with a sentence saying why where the outbox has no `held` (queue it again to send it); one that
says it went, with a sent time and no error, comes in `sent`.

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
  subject. `approvedBy` records who approved it. One approved before its day, or with no day
  worked out, goes at once.
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
| `attach` | no | `{ "kind", "link", "optional"? }`: a document the email carries, drawn by an add-on for the row the outbox link `link` names (a receipt for a sale). `kind` is a document kind (see [Documents](#documents)); `link` is one of the outbox's `links`. A message whose document cannot be drawn fails rather than going without it. With `"optional": true`, a message goes without the document while the add-on that draws its kind is not attached and switched on for the app, and every block marked `"data": { "withAttachment": true }` is left out with it ("Your receipt is attached"). Any other failure to draw it still fails the message. |

Each language is `{ "subject", "preheader"?, "blocks", "footer"? }`: a subject and a preheader of
up to 200 characters, 1–40 blocks, and a footer of up to 1000. A block is
`{ "block", "id"?, "label"?, "data"? }`, where `block` is an email block kind such as `email.text`,
`email.heading` or `email.button`. `email.html` is refused: its variables are not escaped, and an
app's emails show values a stranger typed. The install's check step refuses a block kind the
renderer does not know, or data of the wrong shape.

A template reads variables as `{{name}}`: each link by its name (`appointment.*`, and one foreign
key further, such as `appointment.clinician.*`), `recipient.name` and `recipient.first_name`,
`practice.*`, `appName`, `manage_url` and `booking_url`. A time has the forms `.date`, `.time`,
`.day_month` and `.relative_day` ("tomorrow"), in the recipient's language and the venue's zone. A
number has `.number`, `.percent` and `.money`, written exactly as stored in the message's language
(`{{order.tax_rate.percent}}` is "8.25%" on every engine, never "8.250"); a choice has `.label`,
its label in the message's language (`{{order.paid_method.label}}` is "Card", not "card"); a `text`
column of up to 8 characters holding a time of day has `.time`, in the reader's clock ("3:00 PM" in
the US, "15:00" in Britain); a [code](#column-rules) column has `.grouped` (`K7QX-M2PD`) and `.qr`
(see [Emails that list rows](#emails-that-list-rows)). A `{{was.<column>}}` reads a
[`was`](#outbox) column as it was before a change, in the same forms. A
date has `.day_month` and `.days_since` only: a template asking a column for a form its type does
not have (`{{invoice.due_on.date}}` on a `date` column) is refused at install and on update with
`EMAIL_TEMPLATE_INVALID`, naming the template and the variable.
The guide lists [every variable](/guides/apps/emails/). A message whose email names a variable
nothing fills (a secret column, a personal column of a linked row, a link the row does not have, a
misspelt name) is not sent: it is `failed`, and its error names the variable. `recipient.name` and
`recipient.first_name` are always filled, empty when the recipient has no name on file.

The code a shared link opens a row with (a `claim: { "by": "token" }` column, a project's
`share_token`) opens a page to whoever holds it, so an email carries it only to the person it belongs
to: the message goes to the address the `recipient` row keeps, and the row with the code is that
person's row or links to it by the recipient's `via` column where it has one (`project.client_id`),
else by every link it has to the recipient's table, all naming them. Any other `code` column (a
booking's reference) is printed like any other value.
A message addressed by hand to another address, or one linking one client and another client's
project, is `failed` with a sentence naming the code. A person or an API key making a message (by
hand, or by an import they started), or queueing a held or failed one to go, may link it only to
rows they can read.

Templates are sent through an outbox, so a manifest with `emailTemplates` and no `outbox` is
refused. The install's check step warns when the server cannot send email.

#### Emails that list rows

An `email.rows` block lists the rows of a child table that link to the row an outbox link names,
one line each: an order's dishes, an order's tickets with a QR code each.

```json
{ "block": "email.rows",
  "data": {
    "from": { "link": "order", "table": "order_items", "via": "order_id", "orderBy": "position",
              "unless": "voided", "limit": 50 },
    "joins": { "options": { "table": "order_item_options", "via": "order_item_id", "column": "name",
                            "orderBy": "position", "separator": " · " } },
    "row": { "title": "{{row.qty}} × {{row.name}}", "meta": "{{row.options}}",
             "amount": "{{row.line_total.money}}" },
    "empty": "Nothing on this order." } }
```

| Field | Rule |
|---|---|
| `from` | `link`, one of the outbox's `links`; `table`, the child table, and `via`, its foreign key back to the linked row; then `orderBy`, `where` (`{ "column", "in" }`), `unless` (a bool column that leaves a row out) and `limit`, at most 50 rows. |
| `joins` | 1–2 lists one level further down, gathered into one text per row under their name (a dish's options): `{ "table", "via", "column", "orderBy"?, "separator"? }`. `column` is a `text` column, never a secret, personal, code, share-code or withheld one. |
| `row` | The text of each line: `title`, `meta`, `amount`, `note`, reading `{{row.<column>}}` in every form the column has, `{{row.<link>.<column>}}` through one of the row's own links, and a join by its name. `image` is a QR code of a code column, `{{row.<column>.qr}}`, and nothing else; without it the line has no image cell. |
| `empty` | Said when there are no rows. Without it, the block is left out. |

`{{row.…}}` is read only inside an `email.rows` block, and every language of a template lists the
same rows (`from` and `joins` are the same in each). A message that lists rows is never sent
without its list: when its table or link can no longer be read (after a rename), the message is
`failed` ("Not sent: the email lists rows from a table or link that is not there"). An empty list
still sends.

A QR code is the whole value of an image: an `email.image` block's `qr`, written
`{{<link>.<column>.qr}}` (80–200 pixels across, `size`), or a row's `image`. It is drawn when the
message is delivered, only of a code column, and only for a code of at most 64 bytes. A code the
[withhold](#withheld-columns) or share-code rules keep from the message's recipient is printed
empty, in every form, its QR code included.

## Public access

`publicAccess` says what the app's public screens may do. Each entry becomes an endpoint of the
[public API](/guides/public-api/endpoints-and-keys/) on the real table, served through one of the
app's browser keys and marked as the app's: switching the app off stops it and uninstalling
removes it. Up to 64 entries.

An entry is served through the app's `customer` key unless it names another in `key`. The install
creates one key for `customer` and one for each name in [`publicKeys`](#publickeys). A key the
operator revoked is not made again by an update.

Every update takes back what its version no longer declares: each of the app's keys loses the
entries dropped (the `customer` key is kept, holding nothing if nothing is left), and a key whose
name the version no longer lists in `publicKeys` is revoked. What a version adds — an entry, a key,
or a staff screen's key turned into a shared link's — is given only when the operator allows it on
the update's check, which sends `"publicAccess": true` to `POST /api/v1/apps/{key}/update`.

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
| `writableWhen` | no | The state a row must be in to be changed, per column: `[1–32 values]`, where `null` stands for "still empty" (on a nullable column); `"from-now"`, a `timestamptz` still ahead; `{ "within": <minutes> }`, a `timestamptz` no more than that many minutes ahead (1–1440; a past time always passes; at most one per entry); `"from-today"`, a `date` of today or later on the venue's calendar; `"before-today"`, a `date` already past; or a window on a moment, `{ "after"?, "before"?, "where"? }`, see [Windows on a moment](#windows-on-a-moment). Needs `PATCH`, except a window keyed by a `visibleWith` link on a create. |
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
| `children` | no | The rows a create carries with it, by child table, two levels at most. See [A create with its child rows](#a-create-with-its-child-rows). |
| `agrees` | no | 1–8 checks the created row's own values must pass (guests no more than a room sleeps). See [A create with its child rows](#a-create-with-its-child-rows). |
| `dryRun` | no | `true`: the create or change may be tried without writing, to see every figure Adminium would work out. See [Dry runs, price checks and retries](#dry-runs-price-checks-and-retries). |
| `expect` | no | A money column Adminium works out, which the write may send its expected value for; a different figure writes nothing. |
| `clientKey` | no | A column holding a key the browser mints, so a retried create lands on the same row. |
| `identity` | no | On a create, the person it is made for, found or made by the address typed. See [A person found by address](#a-person-found-by-address). |
| `shareLink` | no | A share-code column: a create answers, once, the new row's own link. See [A row's own link](#a-rows-own-link). |
| `newLink` | no | `{ "column", "kind", "when"? }`: "Make a new link" for a signed-in person's row, or "Send it again" through a row's own link. See [A row's own link](#a-rows-own-link). |
| `forget` | no | On an identity entry: what "delete my details" empties. See [Delete my details](#delete-my-details). |
| `withhold` | no | Columns left out of a row for some readers. See [Withheld columns](#withheld-columns). |
| `limits` | no | Limits on a change a guest makes. See [Limits on a guest's change](#limits-on-a-guests-change). |
| `unlockBy` | no | Rows readable only with a code that unlocks them. See [Codes that unlock rows](#codes-that-unlock-rows). |
| `pictures` | no | 1–4 image columns any visitor may see. See [Pictures](#pictures). |
| `rule`, `showLeft`, `under` | no | On an `availability` entry: which limit it answers, whether it says what is left, and the column a page asks by. See [Availability](#availability). |

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
answers by the limit's kind; see [Availability](#availability). On a booking table it answers the
times of a day, or a strip of up to 31 days, for a kind and optionally a person; a guest is offered
only people bookable online, and is never told who. An availability entry reads no rows, so it is
never the parent another entry is [visible with](#rows-visible-with-their-parent).

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

### Windows on a moment

A `writableWhen` entry may open a change only inside a window read from [moments](#moments): a
refund until seven days before the show, a guest's own change of their stay until the cancel-by
time.

```json
"writableWhen": {
  "status": ["booked"],
  "cancel_by": { "before": {} },
  "event_id": { "before": { "column": "starts_at", "minus": { "days": 7 } },
                "where": [{ "column": "refunds_on", "eq": true }] }
}
```

The key says what the window is read from:

- **A date or time column of the row** (`cancel_by`): the window's moments are that column's,
  so each end names no other `column`; it may add a `time`, a shift and `or` fallbacks.
- **A foreign key of the row** (`event_id`): each end names a `column` of the linked row, and
  `where` (1–8 conditions) must hold on that row too (refunds switched on for the event).

`after` and `before` are the window's ends, either or both. The window is judged on the row as
it is stored before the write, so a change that moves the time cannot reopen its own window, and a
guest may never write a column that opens their own window, a time kept on the row included (an
`arrival_time` a moment reads). A change asked for too early is refused `409` `PUBLIC_TOO_EARLY`
with `params.at` (the row's time) and `from` (when the window opens); one too late, `409`
`PUBLIC_TOO_LATE` with `at`. As with `within`, the refusal is said only for a row the caller's own
read reaches.

A create entry that is [visible with](#rows-visible-with-their-parent) its parent (`POST`, no
`PATCH`) may carry a window keyed by its `visibleWith` link, with the parent's moments at each end:
an extra may be added to a stay only until its cancel-by time. It is judged in the create's
transaction, on the parent.

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

The link opens a page that asks the person to continue and greets them by first name, before
anything is proved. It shows the first word of one column and nothing else: the name the
[outbox](#outbox)'s `recipient.name` declares, when the recipient lives in the same table; with no
outbox recipient there, the first `text` column in the entry's `select` that is not `email`. It
never reads a number, a date, the address, a masked or secret column, or a column the entry does
not `select`. A declared name the entry does not `select` greets nobody by name, so list it in
`select` (a client portal that shows `["id", "company", "contact_name"]` greets by
`contact_name`, not by `company`).

**By a token**: `{ "by": "token", "column", "expires"?, "stopped"? }`. An unguessable code in a
column opens that one row, with no email at all: a handover page shared by link. `column` is a
`text` column with a [`code`](#column-rules) rule of length 16, so Adminium fills it. `expires`
is a `date` or `timestamptz` after which the link opens nothing; `stopped` a `bool` that switches
it off. A token opens its row to whoever holds the link, so it is served on a
[key of its own](#publickeys) that no staff signs in, and every entry on that key only reads
(`GET`) — unless the token is the row's **own link** (`"own": true`, with `address`), which opens a
verified session that may change the row; see [A row's own link](#a-rows-own-link).

A session opened by a token is checked against the row on every request: once the row is
stopped, past `expires`, or given a new code, the link and every session it opened reach nothing,
at once. Nobody types a code, not staff and not an import. Staff who read the table see the code
and can copy the link: the install says the `column` is no secret, on a table it made (on a table
it reuses, it stays whatever it was). No entry of its table shows it, filters or orders by it — the
one the link opens or any other, under any key — so a `select`, a filter or a `rank` that names the
`column` is refused, and an endpoint or a generated one added later is held to the same. To make a
new link, staff with
`update` on the table call `POST /api/v1/data/<connection>/<table>/<record>/regenerate-code` with
`{ "column": "share_token" }`: a fresh code is written, and the old one never opens anything
again. The answer carries the new code only to a caller who may also read the table.

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

### A create with its child rows

A create may carry the rows that belong to it, two levels at most, in one write: an order, its
lines, and each line's options. `children` maps each child table to what the browser may send for
its rows.

```json
{ "table": "orders", "methods": ["POST"],
  "select": ["id", "number", "pickup_at", "subtotal", "tax", "total"],
  "writable": ["name", "email", "pickup_at", "note", "client_key"],
  "requires": ["name", "email"], "humanCheck": true,
  "children": {
    "order_items": {
      "via": "order_id", "writable": ["menu_item_id", "qty", "note"],
      "select": ["id", "qty", "unit_price", "line_total"],
      "requires": ["menu_item_id"], "position": "position", "min": 1, "max": 40,
      "plainText": ["note"],
      "sumMax": { "column": "qty", "max": { "table": "settings", "column": "max_items" } },
      "children": {
        "order_item_modifiers": {
          "via": "order_item_id", "writable": ["modifier_id"], "select": ["id", "name", "price"], "max": 20,
          "agrees": [{ "column": "modifier_id", "path": ["group_id", "item_id"], "eq": { "parent": "menu_item_id" } }],
          "counts": [{ "by": ["modifier_id", "group_id"],
                       "every": { "column": "item_id", "eq": { "parent": "menu_item_id" } },
                       "min": "min", "max": "max" }] } } } },
  "dryRun": true, "expect": "total", "clientKey": "client_key" }
```

Each child table, 1–4 at each level, takes:

| Field | Rule |
|---|---|
| `via` | The child's foreign key to the row it belongs to. |
| `writable` | The columns a child row may set. Never a column Adminium decides, nor a link to the people who sign in (Adminium fills it). |
| `select` | What the reply shows of each child row; without it, the child's key only. |
| `defaults`, `writableValues`, `requires` | As on the entry itself, for the child's rows. |
| `position` | A whole-number column Adminium numbers 1, 2, 3… in the order the rows were sent. |
| `min`, `max` | Rows per parent row: `max` 1–200, `min` no more than `max`. |
| `agrees` | 1–8 checks that tie a row's values to its parent or to what it points at (below). |
| `counts` | 1–2 limits on how many sibling rows fall in one group (below). |
| `plainText` | 1–8 writable `text` columns that hold plain text only, as a [guest's change](#limits-on-a-guests-change) does: no digits, no web address and no `@` handle. A column may be `{ "column": "note", "digits": 4, "max": 140 }` instead: up to 4 digits in all, up to 200 characters. |
| `sumMax` | `{ "column", "max" }`: the most a number column may add up to across the rows of one write (a dozen items to an order), `max` a number or a whole-number setting. |
| `children` | One more level, the same shape without `children` of its own. |

An **agreement** is `{ "column", "path"?, "when"?, <one of "eq", "lte", "gte">: target }`: the row's
`column`, followed along `path` (1–3 foreign keys, the last naming the column compared), equals, is
at most or is at least the target. The target is `{ "parent", "path"? }`, a column of the row it
belongs to; `{ "via", "column" }`, a column of a row this row points at; or `{ "value" }`. `when`
(`{ "path"?, "in" }`) applies it only to rows whose value is one of `in`. On the entry itself,
`agrees` checks the created row's own values (guests no more than a room sleeps), with no `parent`
target. A root `agrees` is held on staff writes to the table too: creates and changes at the desk,
single, bulk or with links. An import is history, and is not held.

A **count** is `{ "by", "every"?, "min", "max" }`: `by` follows the row's foreign keys to its group
(an option's group), whose whole-number `min` and `max` columns bound how many sibling rows fall in
it. `every` (`{ "column", "eq": { "parent" } }`) names the groups judged even when no row falls in
them, those whose column equals the parent row's (a required size left out).

A guest's number that feeds a price Adminium works out (a line's `qty`) declares
`validation.min` (at least 0) and `validation.max`. A create anyone may make with child rows asks
the human check once, for the whole write. Everything is checked by Adminium, never trusted from
the browser, and the whole write is kept or nothing is. For the wire, see
[An order with its lines](/guides/apps/orders-with-lines/).

### Dry runs, price checks and retries

`dryRun: true` lets a page ask for the same create or change without writing: the reply carries
every figure Adminium would work out (the totals, a stay's nights, the stamps it would decide), and
refuses what the save would refuse. A quote takes no locks, keeps nothing and is never charged
against a stranger's limits. A row [visible with a parent](#rows-visible-with-their-parent) is
created alone, so a quote there belongs to a change.

`expect` names a money column Adminium works out (a `decimal` or `money` column that a rule decides),
which the entry shows in `select`. A write may send the figure the guest was shown (`"expect":
{ "total": "34.10" }`); when the save comes to another figure, nothing is written and the answer is
`409` `PUBLIC_PRICE_CHANGED`, with `params.total` and, on a create, each line's figures
(`params.lines`).

`clientKey` names a `text` column, `unique` and `writable`, that holds a key the browser mints for
the create and sends as that column's value: 22–64 letters, digits, `-` or `_`. A retry of a create that already landed (a reply lost to a dropped connection) answers
the same row, marked `replayed`, even after the entry's switch was turned off; a new create with no
matching key is refused as before. Adminium keeps only a keyed hash of the key, 43 characters: give
the column room for it. No entry shows, filters or orders by a retry-key column. `clientKey` belongs
to a create, and not to a row visible with a parent.

### A person found by address

A guest checking out types their address. `identity` finds the person it belongs to, or makes one,
and links the new row to them; the guest is never told which happened.

```json
"identity": { "table": "customers", "email": "email", "link": "customer_id",
              "fill": { "name": "name" } }
```

| Field | Rule |
|---|---|
| `table` | The people table: its identity entry signs people in by an [emailed link](#a-persons-own-rows). |
| `email` | The `text` column of this entry's row the address is typed into: `writable`, in `requires`, with `validation.format: "email"`. The people table's address column is `unique`, nullable (it is emptied when a person is forgotten), kept `normalize: "email"`, and at least as wide. |
| `link` | This row's nullable foreign key to the person. Adminium fills it; it is never shown, since it would tell whether the address was on file. |
| `fill` | Up to 4 `{ "<people column>": "<this row's column>" }`: a new person's `text` columns, filled from what the guest typed. Never a column Adminium decides, a secret, or a unique one. |
| `on` | `{ "to": "<state>" }`, on a change through a row's own link: find the person only on the save that moves the row to that state (a ticket accepted), not on every save made while it has no person. |

A person is found by address whatever its case, and a second person is never made for an address
stored in another case. The entry asks the human check and limits creates per address
(`anonymous.perValue` counting `email`); a signed-in guest's create links them as it always has
(`claimedBy` with `optional: true`). The people table may carry no running number, no limit and no
message on create: each would tell a stranger's order apart from its owner's. Nothing on the row
reads through `link`.

### A row's own link

A row's **own link** opens that one row to its owner: an order's confirmation link, a ticket sent
to a friend. It is a [token claim](#a-persons-own-rows) with `"own": true`, served on a key of its
own:

```json
"publicKeys": { "ticket": {} },
"publicAccess": [
  { "table": "tickets", "key": "ticket", "methods": ["GET", "PATCH"],
    "claim": { "by": "token", "column": "link_token", "own": true, "address": ["pending_email", "holder_email"] },
    "select": ["id", "status", "code", "pending_name", "offer_until"],
    "withhold": { "columns": ["code"], "when": { "where": [{ "column": "holder_customer_id", "isNull": true }] } },
    "writable": ["status"], "writableValues": { "status": ["valid"] },
    "writableWhen": { "status": ["offered"] },
    "identity": { "table": "customers", "email": "pending_email", "link": "holder_customer_id", "on": { "to": "valid" } } }
]
```

- **Handed once.** A create entry's `shareLink` names the row's own-link column: the create answers
  the new row's link, once, to whoever made it. Otherwise the link is only ever emailed, to the
  row's own address: `address` names the 1–2 `text` columns it may go to (the holder's, and the
  friend it is offered to).
- **Verified.** The link opens a `verified` session, and the key's entries may change the row
  within their `writable` list; every entry on the key is read at `level: "verified"`. A link that
  opens nothing (stopped, expired, renewed) answers `410` `LINK_EXPIRED`.
- **Bound to its address.** When the address it was sent to changes, the sessions it opened stop.
  An entry whose change writes one of the `address` columns must [renew](#codes-that-renew) the
  link's code on that change: `rules.code.renew.on` `{ "column": "<address>", "changed": true }`.
  No browser writes the link's own column, its `expires` or its `stopped`.

`newLink: { "column", "kind" }` on an entry that reads a signed-in person's rows (`claimedBy`) lets
the person ask for a fresh link: `POST /api/v1/public/records/<ref>/<id>/new-link`. The row's own
link gets a new code, which stops every session the old one opened, and the new link is emailed as
the app's outbox message `kind`, sent once per code. The outbox needs a `repeatKey` column, a link
to the table, and its recipient table must be the `claimedBy` table. Only a verified sign-in may
ask, five times a day per row; a second ask within a minute changes nothing; when the email cannot
go, the answer is `503` `PUBLIC_CODE_UNAVAILABLE`. See
[Guests, their details and their own links](/guides/apps/identity-and-own-links/).

On a row's own-link entry, `newLink` makes another own link of the row again ("Send it again" for a
confirmation email): `column` is a code another key opens this table by with `own: true`, never the
entry's own. The email goes to the row's own address, as the outbox's other messages about the row,
and the asking session stays open. The address is the one the kind's own producer uses, read from
the row, and no entry may let a guest change it. Here `when: { "where": [conditions] }` is required
(it is optional on a signed-in entry): the ask goes only while the row holds every condition, and
never while that link is stopped; otherwise it is refused `409` `PUBLIC_WRITE_REFUSED`, with nothing
made, sent or counted. Besides 5 a day per row, it is 5 a day per mailbox over the whole table.

### Delete my details

`forget` on an identity entry that signs people in by email lets a person delete their details
(`DELETE /api/v1/public/account`, with a code confirmed or a link pressed in the last ten minutes,
else `403` `PUBLIC_CODE_STEP_UP`).

```json
"forget": { "columns": ["name", "email", "phone"], "stamp": "forgotten_at", "links": true }
```

`columns` lists 1–16 nullable columns of the person's row that are emptied, the address they sign
in with among them; never the key, nor a column Adminium decides. `stamp` is a nullable
`timestamptz` written with the time they were forgotten. With `"links": true`, every own link of the
rows the person holds is renewed first and the sessions those links opened are ended (a device
learns it by the `x-adminium-session-ended: forgotten` header, once); if that cannot be done,
nothing is forgotten. A message about a forgotten person is not sent, even one queued before they
asked. Every session the person holds can also be ended without forgetting anything:
`POST /api/v1/public/session/revoke-all`.

### Reads for a signed-in guest

An entry with a `level` and no `claim`, `claimedBy` or `visibleWith` reads its table's rows (within
its filters) for a signed-in session of its key alone, never for a stranger: a hotel's rate cards
shown to a guest who has booked. It only reads, lists what it shows in `select`, and says the
`level` its key's sessions are.

### Withheld columns

`withhold` leaves some columns out of a row for some readers: a ticket sent on to a friend keeps
its code from the buyer who sent it, and tickets of an order not yet paid show no code at all.

```json
"withhold": { "columns": ["code", "holder_email"], "unlessHolder": "holder_customer_id",
              "when": { "linked": [{ "via": "order_id",
                                     "where": [{ "column": "status", "in": ["held", "awaiting_transfer"] }] }] } }
```

| Field | Rule |
|---|---|
| `columns` | 1–8 columns of the entry's `select`, each once. |
| `unlessHolder` | On rows read through a parent (`visibleWith` or `claimedBy`): a foreign key to the person the key signs in. The columns are left out while it names someone other than the reader. |
| `when` | `{ "where"?, "linked"? }`: the columns are left out while the row, or a row one of its links points at, meets the conditions. |

A withhold names `unlessHolder`, `when`, or both; either one holding leaves the columns out. A
`when` holds for readers of the key the declaring entry is served through; mail and documents drawn
for a person read as the `customer` key, and a message to an address column as the row's own link
whose `address` names that column. A reader of no key at all (a document drawn for nobody) meets
every `when` about the row's state, and none declared through a row's own-link key. On a row's own
link, which names nobody, a withhold says `when` alone. No browser writes a column a withhold's
conditions read.

The columns are left out of every public read of the table, whichever entry declared the rule:
lists, one row, a change's reply, a replayed create, files, emails (values, rows and QR codes) and
documents. Filtering, searching or sorting by one is refused `400` `PUBLIC_QUERY_REFUSED`; a file
in one is served to its holder only; an email's `joins` and a document's lists never name one.

### Limits on a guest's change

`limits` holds a change a guest makes, signed in or not, on a `PATCH` entry: a ticket sent on to
a friend's address.

```json
"limits": { "perValue": { "columns": ["pending_email"], "n": 5 }, "plainText": ["pending_name"] }
```

`perValue` (`{ "columns", "n" }`, 1–4 `text` columns, 1–20) allows each value at most `n` changes a
day that write it: an address a ticket is sent on to. `plainText` lists 1–8 writable `text` columns
that hold plain text only: letters, spaces and sentence punctuation (Latin, CJK and Arabic), up to
80 characters, no digits, no web address (a known ending such as `.com`, or a `/`) and no `@`
handle; "Mary.Ann", "J.R.R. Tolkien" and "St. John" pass. A column given as
`{ "column", "digits", "max" }` takes up to `digits` (1–4) digits and `max` (at most 200)
characters. A stranger's create's
[`plainText`](#limits-on-a-strangers-create) is the same rule. A limit names `perValue`, `plainText`, or both. Over a limit is `409`
`PUBLIC_LIMIT_REACHED`; a value that is not plain text is `400` `PUBLIC_WRITE_REFUSED`.

### Codes that unlock rows

`unlockBy` makes an entry's rows readable only with a code that unlocks them: a presale code that
reveals its hidden ticket type.

```json
{ "table": "ticket_types", "methods": ["GET"], "select": ["id", "name", "price"],
  "unlockBy": { "table": "presale_codes", "column": "code", "link": "ticket_type_id",
                "where": [{ "column": "active", "eq": true }] } }
```

A row of `table` whose `column` holds the typed code, and whose `link` points at the entry's row,
unlocks it. `column` is compared as a [typed code](#typed-codes) (`normalize: "code"`, or a `code`
column) and finds one row; `where` takes the same conditions as a lookup's. The entry only reads,
and is its own entry: no claim, no parent, not an availability entry. The code travels in the
`x-adminium-code` request header, never in the address: `?code=` is refused `400`
`PUBLIC_QUERY_REFUSED`.

### Pictures

`pictures` lists 1–4 image columns any visitor may see through the rows an entry reads: a dish's
photo on the menu, a room type's picture.

```json
{ "table": "menu_items", "methods": ["GET"], "select": ["id", "name", "price", "photo"], "pictures": ["photo"] }
```

Each is a `text` column with `semantic: "image"`, in `select`, never writable, never personal or
kept from readers, and not one of the entry's `files`. The entry only reads rows, on the app's
`customer` key. A picture is served at `GET /api/v1/public/pictures/…` only for the row it is
attached to, cleaned once and kept beside its file. See
[Pictures on public pages](/guides/apps/public-pictures/).

### Availability

An `availability` entry on a table with a [`capacity`](#capacity) answers by the limit's kind:

| Kind | A page asks | The answer |
|---|---|---|
| `slot` | A day (or a run of days) and a party | Each slot, free or full. |
| `parent` | The pools under a row (`under`: a column of the pool's rows, such as an event's ticket types) | Each pool, on sale or sold out. |
| `night` | Arrival and departure, and the guests | Each pool that has a room on every night. |

| Field | Rule |
|---|---|
| `rule` | Which of the table's limits it answers, 0–2 (absent: the first). |
| `showLeft` | `{ "below": n }` or `{ "belowShare": 1–100 }`: say how many are left, but only when little is (below a number, or a share of the pool). A parent or night limit only. |
| `under` | A parent limit only: the column of the pool's rows a page asks by. |

A night rule counting one unit per row (`size: 1`) has no pool to answer. A slot rule whose
`amount` is a column needs that column's `validation.max`: a party asked about is capped at it, or
a page asking ever larger parties would learn how full each time is. Parent and night answers read
the pool's rows, so the key also needs a plain read entry on the pool's table. Rows of the
session's own open hold are left out of a count when asked (`exclude`); ids outside the session
are ignored. A code that unlocks a hidden pool travels in the `x-adminium-code` header. For the
query parameters, see the [REST API](/reference/rest-api/).

### Limits on a stranger's create

`anonymous` limits a create that nobody signed in for: an entry with no claim at all, or an
optional `claimedBy` create made with no session. It needs `POST`.

| Field | Rule |
|---|---|
| `perValue` | `{ "columns", "n" }`: at most `n` (1–20) creates a day for one phone number or address in any of these `text` columns (1–4), through any key or page. A phone number counts by its last nine digits, and an address in lower case, so two spellings of one number are one number. |
| `perKeyHour` | At most this many (1–1000) such creates an hour through the key, from everyone. |
| `perIpHour` | At most this many (1–60) such creates an hour through this entry from one visitor (an IPv6 subscriber's whole /64). Every visitor is held to 60 an hour on any key; this only lowers it. |
| `plainText` | 1–8 `text` columns that hold plain text only: letters, spaces and sentence punctuation (Latin, CJK such as `，。` and Arabic such as `،`), up to 80 characters, with no digits and no web or email address in its common forms (a known ending such as `.com`); "Mary.Ann", "J.R.R. Tolkien" and "K.Y.Ng" pass. A column given as `{ "column": "note", "digits": 4, "max": 140 }` takes up to `digits` (1–4) digits in all and up to `max` (at most 200) characters ([Plain text](/guides/apps/identity-and-own-links/#plain-text)). The same rule as a [guest's change](#limits-on-a-guests-change), held on every create (signed in or not) and on every change that writes the column. |

A create over a limit is refused with `PUBLIC_LIMIT_REACHED`, and one that breaks `plainText` with
`PUBLIC_WRITE_REFUSED`. A single create refused for another reason (the slot was taken) does not
count, except against the visitor's hour. A [create with child rows](#a-create-with-its-child-rows)
gives its charge back only when a value the guest typed was refused; any other refusal of the whole
write (sold out, busy, a changed price) keeps it. A [quote](#dry-runs-price-checks-and-retries) is
never charged.

An entry anyone may call (no claim, no parent, or a create a session is optional on) may not
`select` a personal column: one marked `personal`, or one whose name the install reads as personal
data (an address, a phone number, a birth date, a person's name on a table of people).
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

The file must be in `seeds/` and end in `.json`. `skipWhenShared` (`{ "table", "skip": [1–50
table refs] }`) leaves the listed tables' sample rows out when `table` is a [shared
table](#shared-tables) another installed app uses and it already holds real rows (rows no app's
sample added): a venue's real menu never gains sample dishes, nor sample orders of them. The list
must include every table that links to a skipped one. After installing, the operator can add the
sample data in one step and later remove it. Removal shows a preview first. It keeps every sample row the
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
| `weekAnchor` | Optional: the weekday (`mon` … `sun`) the sample was written for, which `@week` days count from. |

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
| `{ "@in": "PT20M", "@grid": 15 }` | An ISO 8601 duration after now. With `@grid`, rounded up to the next step of that many minutes on the venue's own clock, counted from its midnight (never past the next midnight): the first pickup slot at least 20 minutes away. |
| `{ "@in": "PT20M", "@slot": "orders" }` | The first open time of that table's [slot limit](#slot-limits) at least that far ahead: its hours, closures and pauses, on its grid, with room left after the sample's own rows placed so far; on the next open day when today has none, looking two weeks ahead, else the plain `@in` time. Not with `@grid`. |
| `{ "@day": -1, "@time": "09:30" }` | A wall time in the venue's time zone, a number of days from today (−366 to 366). |
| `{ "@day": 3 }` | A date: that many days from today, as the venue's calendar has it. For a `date` column. |
| `"@workdays": true` | Added to either `@day` form: the days count Monday to Friday only, and day 0 on a weekend is the Monday after. So the sample's busy day is never a Saturday. |
| `"@week": true` | Added to either `@day` form instead: the days count from the bundle's `weekAnchor` in the week nearest today (three days either way), so every date keeps the weekday it was written for: a weekend stay stays on a weekend, whatever day the sample is added on. Needs `weekAnchor`. |
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
row out altogether: a payment for a visit that has not happened yet.

A row that lasts from one time to another (a stay) may carry `@byStay` instead, placing it by where
the adding moment falls against its two times:

```json
{ "@label": "stay-4", "arrive": { "@day": -1, "@week": true }, "depart": { "@day": 2, "@week": true },
  "status": "booked",
  "@byStay": { "from": "arrive", "to": "depart", "times": { "from": "15:00", "to": "11:00" },
               "during": { "status": "in_house" }, "after": { "status": "departed" } } }
```

| Field | Rule |
|---|---|
| `from`, `to` | The arrival and the departure: columns the row sets, or `@day`s. |
| `times` | `{ "from"?, "to"? }`: the wall times a date is read at (arriving from 15:00, leaving by 11:00); else its midnight. |
| `before`, `during`, `after` | Columns merged when the adding moment is before the stay, during it, or after it. |

A row takes one of `@byClock` and `@byStay`. A later `@ref` to a row a `@skip` left out fails.

Every table that keeps totals is settled once all the sample rows are in, so a sample
visit's balance is right from the start. The totals so far are also settled before each table's
rows go in, so a row that copies a total from an earlier table (a stage invoice copying its quote's
subtotal) reads it worked out.

A row may also carry `"@onlyIfEmpty": true`, for a table that holds one row, such as the app's own
settings. The row is added only when the table is empty. When the operator already has a row there,
the sample leaves theirs alone, and a `@ref` to the sample row's label points at theirs.

A table of many rows the operator sets up themselves (a kitchen's opening hours, one row a
weekday) takes `"onlyIfEmpty": true` on the table instead: its rows go in only when the table holds
none, and otherwise all of them stay out. No row may `@ref` a row of such a table, since it may not
be written.

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
manifest with warnings validates. Today there are four:

- a column that is neither nullable nor given a `default`, a role or a rule that fills it will be
  `NOT NULL` once installed, so every new row must give it a value, and a draft saved half-filled
  is refused;
- a `text` column in a [unique set](#columns-unique-together) with no `normalize` (and no `code`
  rule): MySQL compares text ignoring case and accents, Postgres and SQLite do not, so give it
  `normalize: "email"` or `"trim"`;
- a [setting](#settings) whose key reads like bank details and is not `secret`: a setting that is
  not secret is published to the customer side;
- a capped balance whose `of` is a formula reading a column that stays writable while the capped
  rows can exist: a bulk edit or an import settles the balance without the cap (see [Totals that
  count and climb](#totals-that-count-and-climb)).

Keep warnings apart from issues in your CI, so that new advice never fails a build.

```json
{ "ok": true, "manifest": { … }, "warnings": [
  { "path": "requiredSchema.tables.2.columns.4",
    "message": "\"invoices.client_id\" has no default and is not nullable, so it will be required at install: every new row must give it a value" } ] }
```
