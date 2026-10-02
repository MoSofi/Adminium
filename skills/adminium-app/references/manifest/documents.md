<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Documents; do not edit -->

# Manifest spec: Documents

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
| `name` | yes | A plain string or a keyed [label](https://docs.adminium.dev/reference/manifest/#conventions). |
| `mapping` | yes | From each of the add-on's slots (letters, digits and `_`, starting with a letter) to where its value comes from. See below. |
| `statement` | no | Makes the document a statement. See below. |
| `feature` | no | One of the app's [`addOns.features`](https://docs.adminium.dev/reference/manifest/#add-ons). |
| `requestValues` | no | 1–8 slots the app's own screen may fill when it asks for the document (a label sheet's `count`). Each must be a slot the entry does not map; when the add-on is attached, its outline must have the slot, with no default, holding a number or a text. See below. |
| `where` | no | `{ "column", "in": [...] }`: only rows whose column holds one of 1–16 values have this document (a `receipt` for `payments.kind` `taken`, not for money given back). Asked for another row, the render answers `409` `DOCUMENT_NOT_FOR_ROW`; an email that would carry it goes without it. |

The slots are the add-on's words (`number`, `issuedAt`, `items`): a shape's own profiles, in the
add-on's manifest, show the ones it draws. Each slot reads one of:

| Source | Reads |
|---|---|
| `{ "column", "form"? }` | A column of the row. |
| `{ "via", "column", "form"? }` | A column of the row a foreign key `via` of this table points at: the client's name on an invoice. |
| `{ "collection": { "table", "via", "orderBy"?, "columns", "where"?, "unless"? } }` | A list of child rows, whose foreign key `via` points at this table, in `orderBy` order. `columns` maps the add-on's names for a line's values to the child's columns. `where` (`{ "column", "in": [1–16 values] }`) keeps only the rows whose column holds one of the values; a row whose `unless` column is true or set is left out (a voided line). |
| `{ "collection": { "nightly", "columns" } }` | The nights a [price by the night](https://docs.adminium.dev/reference/manifest/#prices-by-the-night) of the row is made of, one line each, worked out when the document is drawn. `nightly` names the priced column; `columns` maps a line's values to a night's own `date`, `rate`, `base`, `qty` and `tags`, or to `<rate via>.<column>`, a column of the row the rate comes from (`room_type_id.name`). |
| `{ "collections": [1–4 sources] }` | One list from several sources, in order, each a table source or a nightly source as above: a folio's nights, then its extras, then its charges. |

A line's value in a table source may also be a list of names one level below the line, printed one
after another (a dish's options, "Farro · Grilled chicken · Avocado"):
`{ "list": { "table", "via", "column", "orderBy"? } }`, where `column` is a `text` or `enum` column
of the rows whose `via` points at the line. Such a list never names a secret, personal, code or
withheld column. `"form": "grouped"` prints a [code](https://docs.adminium.dev/reference/manifest/#column-rules) column in groups of four
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

When a table is [built on an add-on's shape](https://docs.adminium.dev/reference/manifest/#tables-built-on-an-add-ons-shape), the shape's own
profiles are made for it at install. An app entry of the same kind on that table does not make a
second profile: its slots are added to the shape's mapping (the app's slot wins on the same name,
so an invoice can print the client's address from the app's own `clients` table), and its `name`
replaces the shape's.
