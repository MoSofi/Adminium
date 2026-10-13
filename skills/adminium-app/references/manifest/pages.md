<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Pages; do not edit -->

# Manifest spec: Pages

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
| `config` | no | Page configuration: a `form` for a record page, a `layout` for `page-dashboard`, a `calendar` for `page-calendar`, a `board` for `page-board`. |
| `feature` | no | The id of one of the app's [`addOns.features`](https://docs.adminium.dev/reference/manifest/#add-ons). Until every add-on the feature requires is installed, attached to the app and switched on there, the page leaves the sidebar and is listed apart, with the add-ons it needs. |
| `module` | no | The [part](https://docs.adminium.dev/reference/manifest/#parts) of the app the page belongs to. While that part is off the page leaves the sidebar and its address answers `409` `PART_OFF`. Needs Adminium 0.3.28. |

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

`config.board` says what the columns of a `page-board` are. It needs
`"minAdminiumVersion": "0.3.28"`.

```json
"config": { "board": {
  "column": "stage_id",
  "columnsFrom": { "table": "stages", "label": "name", "order": "position" },
  "title": "name",
  "totals": [{ "column": "amount", "fn": "sum" }],
  "only": { "state": "open" }
} }
```

| Field | Required | Rule |
|---|---|---|
| `column` | yes | The column of the page's table a card is placed by. With `columnsFrom` it is a link (`"type": "fk"`) to that table. Without `columnsFrom` it is an `enum` column, and the board's columns are its values. |
| `columnsFrom` | no | `{ "table", "label", "order" }`: the table of the app whose rows are the board's columns, the column of it a board column is headed with, and the column the board's columns are ordered by. `order` may be left out; the columns are then in the order of their key. |
| `title` | no | The column of the page's table a card is titled with. Left out: the table's own title column. |
| `totals` | no | One or two `{ "column", "fn" }`: a number or money column of the page's table, and `sum` or `avg`. Each column's header shows the figure beside its count. |
| `only` | no | Which rows of the page's table are cards on the board: one to three `"column": value` or `"column": [values]` (up to 20 values each). A row is a card when every column named holds its value, or one of its values. Left out: every row. |

With `columnsFrom` the board draws one column for each row of that table, a row with no card
too, and reads them when the page opens. A row added, renamed, moved or removed there changes the
board for everybody looking at it, with no update of the app. A card whose link is empty is on no
column. Dropping a card on a column saves that row's key in the card's link, as any save of the
record would: where a role's limit or a state rule refuses the save, the card goes back and the
board shows the reason.

The count and the totals in a column's header are worked out on the server, over the rows the
person may read: a rep held to their own deals sees the count and the worth of their own. Money
is shown in the install's currency. A board draws the first 200 cards of its table; the count is
of all of them. It draws at most 100 columns.

`only` makes the board a board of some of its table's rows: `"only": { "state": "open" }` is the
open deals, `"only": { "kind": ["new", "renewal"], "hot": true }` the hot deals of two kinds. It
holds for the cards and for the headers alike, so a column's count and totals are of the cards
`only` keeps. A column of `only` is an `enum`, a `bool`, a link (`fk`, by the key it holds),
`text` or a whole number (`int`, `bigint`) of the page's table, and not the board's own `column`;
a value of an `enum` is one of its values. A role that may not read a column `only` names (it is
not among the role's `readable` columns, or it is personal data the role may not read) gets
neither the cards nor the figures: the headers show no count and no total, never those of every
row. So name a column every role that opens the board may read.
