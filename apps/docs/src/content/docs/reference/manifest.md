---
title: Manifest spec
description: The manifest.json every app and add-on package carries — identity, tables, pages, frontends, roles, settings, public access and sample data, field by field.
---

A **manifest** is the `manifest.json` at the root of an app or add-on package. It tells Adminium
what the package is, which tables it needs in the operator's database, and what it adds on top of
them: pages in the sidebar, roles, settings, frontends, public endpoints and sample data. Adminium
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
| `capacity` | no | A booking limit on the table; see [Capacity](#capacity). |

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
| `label` | no | A [label](#conventions) for the column: a form field, a list heading. |
| `rules` | no | Rules Adminium keeps on the column; see [Column rules](#column-rules). |

A `NOT NULL` column with no default refuses every insert that leaves it out, which includes every
record added from a form that does not show it. Give such columns a `default`, or make them
`nullable`.

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
| `options` | `{ "list": "<name>" }` or `{ "values": [{ "value", "label"?, "tone"? }] }` | The allowed values. `list` names one of the app's [option lists](#option-lists), or a built-in list: `builtin:countries`, `builtin:us-states`, `builtin:gender`. Inline `values` take 1–500 entries. |
| `enumLabels` | `{ "labels": { "<value>": label }, "tones"?: { "<value>": "<tone>" } }` | Display labels (and badge tones) for an enum's values. |
| `required` | `true` | The server requires a value on every write. |
| `validation` | `{ "format"?, "min"?, "max"?, "minLength"?, "maxLength"? }` | `format` is `email`, `url` or `phone`. |
| `copy` | `{ "via", "from", "mode"? }` | Copies a value from a linked row. `via` is a foreign-key column of this table, `from` a column of the table it points at. With `mode: "default"` (the default) the copy fills only a value the write leaves out; with `"always"` it always wins. |
| `sequence` | `{ "start"? }` | The next number in this column's own counter. `start` is at least 1. |
| `code` | `{ "length", "prefix"? }` | A short random code, unique in the column. `length` is 4–12; `prefix` is upper case, up to 6 characters plus an optional `-` (`MR-`). |
| `rollup` | `{ "from", "via", "sum", "times"?, "unlessSet"? }` | A total over child rows, kept up to date as they change. `from` is the child table, `via` its foreign key back to this table, `sum` the column to add up. `times` multiplies each row (a quantity); a child row with a value in `unlessSet` is left out (a voided line). |
| `venueLocal` | `true` | A wall time given with no zone is read in the venue's time zone. |
| `personal` | `true` or `false` | Whether the column is personal data, overriding the guess Adminium makes from the column's name. |

Tones are the dashboard's badge colours: `neutral`, `accent`, `info`, `pos`, `warn` and `danger`.

`copy`, `sequence`, `code` and `rollup` are values **Adminium decides**: they are filled on the
server, so a browser never picks a price, a number or a code. They cannot be listed as `writable`
in [public access](#public-access), and a primary key cannot take `sequence` or `code`.

Every name a rule uses is checked against the manifest: `copy.via` must be a foreign key of the
table, `rollup.via` must point back at this table, and so on.

```json
{ "ref": "subtotal", "type": "money", "default": 0,
  "rules": { "rollup": { "from": "ticket_items", "via": "ticket_id", "sum": "unit_price",
                         "times": "qty", "unlessSet": "voided_at" } } }
```

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
| `config` | no | Page configuration: a `form` for a record page, a `layout` for `page-dashboard`. |

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
browser key the install creates. Each side reads its `surface-config.json` at boot: the real table
names, the app's settings and, for the staff side, the connection and the venue's time zone and
currency.

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
| `cloneFrom` | no | The key of another of this app's roles, whose grants this role also gets. |
| `screensOnly` | no | `true`: people with this role open the app's own screens and never the dashboard. |

A manifest cannot know the real table names or page ids, so it grants through placeholders:

| Grant | Actions |
|---|---|
| `table:@<table ref>:<action>` | `read`, `create`, `update`, `delete`, `export`, `import` |
| `page:@<page ref>:<action>` | `view`, `edit` |
| `app:@:staff` | Open the app's staff screens. |

The plan refuses a `system:` grant, a wildcard, and a reference to a table or page the manifest
does not declare. Grants are given once: an update adds what a new version asks for, and an
operator's narrowing of an app role survives it.

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

## Public access

`publicAccess` says what the app's public screens may do, through the one browser key the install
creates. Each entry becomes an endpoint of the [public API](/guides/public-api/endpoints-and-keys/)
on the real table, marked as the app's: switching the app off stops it and uninstalling removes it.
Up to 32 entries.

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
| `methods` | yes | At least one of `GET`, `POST`, `PATCH`. `PATCH` needs a `claim`. |
| `kind` | no | `records` (the default) or `availability`. |
| `select` | no | The columns a response carries. Default: every column the app declares for the table. |
| `writable` | no | The columns a create or change may set. Never a column whose value Adminium decides. |
| `filters` | no | Rows the endpoint can reach at all: `{ "column", "op", "value" }`, with `op` one of `eq`, `neq`, `in`, `gte`, `lte`. |
| `defaults` | no | Values the server writes whatever the browser sends. |
| `claim` | no | `{ "match": [1–3 columns] }`. The caller proves they know a row's details (a booking code and a mobile number) to reach that row, and only that row. |
| `confirm` | no | An email Adminium sends when a guest creates a row; needs `POST`. See below. |

`confirm` takes `template` (only `booking-confirmation` today), `to` (the column holding the
guest's address) and optionally `code`, `when`, `party` and `name` (columns the email shows),
`venue` (`{ "table", "name"?, "address"?, "phone"? }`, the app's one-row venue table) and `link`
(a path under the customer side, up to 200 characters).

An `availability` entry answers free or full for each slot of a day and never returns a row. It
is `GET` only, and the table must declare a [`capacity`](#capacity).

The install's check step lists every endpoint it will create, and warns about anything that would
stop the key working, such as the public API being off or no time zone set on the database.

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
| `{ "@t": { "en-US": "…" } }` | Text in the language of the person adding the sample. Keys are `xx` or `xx-XX`. |
| `{ "@asset": "<label>" }` | A file from `assets`, added to the Files library. |

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
  `sampleData` or `seeds`. An add-on's own screens are code it ships, declared under
  `addOn.pages`.
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
- **Cross-references.** Every name the manifest uses must be declared in it: a rule's columns, a
  capacity's columns, a public entry's table and columns, an option list, a foreign key's target.
  A `PATCH` without a `claim`, a writable column that Adminium decides, and an `availability`
  entry on a table with no `capacity` are refused.
- **Policy.** The publisher must be `adminium`, and the key must not be reserved.
- **The version floor.** An app or add-on whose `minAdminiumVersion` is newer than the server is
  refused with a message naming both versions, including when an older server cannot parse a
  newer manifest.
- **The install plan**, against the operator's database: name lengths for that database (63 bytes
  on Postgres and SQLite, 64 on MySQL, including foreign key names `fk_<table>_<column>`), role
  names, page forms, and tables that are taken.

There is no published JSON Schema file for manifests. The schema itself is published as the
`@adminiumjs/manifest` npm package. Its `validateManifest(document)` runs the schema,
cross-reference and policy checks and returns every issue, so an app's own CI can refuse a bad
manifest before it is released.
