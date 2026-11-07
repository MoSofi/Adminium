<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Columns; do not edit -->

# Manifest spec: requiredSchema — Columns

### Columns

```json
{ "ref": "status", "type": "enum", "enum": ["open", "paid", "void"], "default": "open",
  "label": { "en-US": "Status", "de-DE": "Status" } }
```

| Field | Required | Rule |
|---|---|---|
| `ref` | yes | snake_case; in a self-made app, the column's own name may be kept (`orderDate`, `Order Total`): see [Columns under their own names](https://docs.adminium.dev/reference/manifest/#columns-under-their-own-names). |
| `type` | yes | One of the [column types](https://docs.adminium.dev/reference/manifest/#column-types). |
| `nullable` | no | `true` makes the column nullable. **Columns are `NOT NULL` unless you say otherwise.** A primary key is never nullable. |
| `role` | no | `pk` (primary key), `created_at` or `updated_at`. A `timestamptz` or `date` column whose role is `created_at` is filled with the moment its row is made, and one whose role is `updated_at` with the moment of every change too, whatever the column is called, through every door: the desk, a guest's create, a change through a link. In a table that gives a role, another column whose name alone would say the same moment (an `updated_at` beside a `changed_on` with the role) is left as written. A table with no roles is stamped by its columns' names (`created_at`, `updated_at`). A column whose own rules fill it (`default`, `stamp`, `formula`, `copy`) keeps them. Read by Adminium 0.3.43 and later; an older release stamps by name only. |
| `semantic` | no | A hint for widgets: `name`, `money`, `image`, `email`, `avatar`, `geo-lat`, `geo-lng`. `money` (like a `money` column, or `"scale": "currency"`) makes the column money wherever Adminium draws it, whatever it is called: a board's totals and card, a chart's **Show data** table, a list. Read by Adminium 0.3.28 and later; an older release takes it as a hint only. |
| `enum` | for `enum` | The allowed values, at least one. |
| `references` | for `fk` | The `ref` of the table this foreign key points at. That table must declare exactly one `pk` column; the foreign key takes its type. A name the manifest does not declare is a table the database already has (a shop's own `customers`, with a one-column primary key): the app then installs only on a database with that table, the check warns about it, and anywhere else the install is refused (`UNRESOLVED_REFERENCE`). Adminium's own `adminium_*` tables can never be linked to (`RESERVED_TABLE`). |
| `maxLength` | no | `text` only: creates `varchar(n)` instead of unbounded text. 1–1000. Leave it out for long text (notes, a description): text with no `maxLength` has no limit. |
| `scale` | no | `decimal` and `money` only: the places kept after the point. See [Decimal places](https://docs.adminium.dev/reference/manifest/#decimal-places). |
| `precision` | no | `decimal` and `money` only: the digits kept in all, 1–65, beside `scale` (`decimal(10,2)` is `"precision": 10, "scale": 2`). At least the places after the point (4 when `scale` gives none). Without it a decimal is made with 19. Needs Adminium 0.3.49. |
| `hidden` | no | `true` keeps the column off forms and lists; `false` shows it again. Installed as the column's hidden mark, which the operator may change. Needs Adminium 0.3.49. |
| `yesNo` | no | `true`, on an `int` column: it holds a yes or a no (a `smallint` flag), and is read, written and shown as one on every engine. A `bool` column is one already. Needs Adminium 0.3.49. |
| `relation` | no | On an `fk` column: `{ "label"?, "remove"?: true, "constraint"?: false }`, at least one of them. `label` (1–120 characters) is the link's own name. `remove` keeps the foreign key in the database but Adminium does not show the link. `"constraint": false` makes no foreign key: Adminium shows and follows the link itself, as for a link a person adds in Studio. Needs Adminium 0.3.49. |
| `default` | no | The value the database fills when an insert leaves the column out. See [Defaults](https://docs.adminium.dev/reference/manifest/#defaults). |
| `unique` | no | `true`: no two rows may hold the same value. Empty values do not count, so many rows may leave it empty. Not on the primary key, a `json` or a `blob` column; a `text` column needs `maxLength`, because MySQL cannot index unbounded text. |
| `index` | no | `true`: a plain index on a foreign key a [limit](https://docs.adminium.dev/reference/manifest/#capacity) or a [total](https://docs.adminium.dev/reference/manifest/#totals-and-balances) counts by, so the count reads the rows it needs and not the whole table. Only on such a foreign key, and never on one that is `unique` already. |
| `label` | no | A [label](https://docs.adminium.dev/reference/manifest/#conventions) for the column: a form field, a list heading. |
| `rules` | no | Rules Adminium keeps on the column; see [Column rules](https://docs.adminium.dev/reference/manifest/#column-rules). |

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
shape](https://docs.adminium.dev/reference/manifest/#tables-built-on-an-add-ons-shape), whose own writes could break it.

A set becomes a unique constraint when Adminium creates the table (a unique index on SQLite), and
an update that adds a set to a table that already has rows first checks that no two rows repeat
it: the check names the table and columns (`UNIQUE_DUPLICATES`), and nothing changes until they
differ. A write that would repeat a set is refused `409` `UNIQUE_VIOLATION`, with
`details.columns` naming the set. A plain [`index`](https://docs.adminium.dev/reference/manifest/#columns) is added the same way, at install or
by an update.

#### Column types
