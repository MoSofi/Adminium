<!-- produced from apps/docs/src/content/docs/guides/apps/sample-data.md § Rows for an add-on the app names; do not edit -->

# Sample data: Rows for an add-on the app names

An app may ship sample rows for the tables of an add-on it names, in a file of their own:

```json
"sampleData": { "file": "seeds/sample.json",
                "addOns": { "stock-kit": { "file": "seeds/stock.sample.json" } } }
```

The file says which add-on it is for (`"addOn": "stock-kit"`) and lists that add-on's tables by
their short names. A table of the app itself that links into the add-on goes in the same file,
marked `"own": true`. A row may point at a row of the app's own sample or of the add-on's own
sample by its label (`{ "@ref": "…" }`), and name one of the app's tables with `{ "@table": "orders" }`.

These rows are added with the app's sample while the add-on is installed in the same database,
connected to the app and switched on. They are listed as the app's, and removing the app's sample
takes them out again. A file that names rows of the add-on's own sample waits until that sample is
loaded, and is taken out before that sample is, own rows and all.

An app never ships an add-on's history: what was counted is the add-on's to write. A movement, a
level, a reservation, a balance, a receipt — any table a total adds up, or that holds a total — is
refused in the file. What an add-on's ledger writes **beside** its books is not history, and an app
may ship it: the rows that say which of the app's rows uses which of the add-on's (Inventory's
`links`: "this visit type offers the flu kit", "this dish uses these items").

```json
{ "format": "adminium.sample/1", "app": "clinic", "addOn": "inventory",
  "tables": [
    { "ref": "links", "rows": [
      { "source_table": { "@table": "appointment_types" }, "source_row": { "@ref": "type:nurse" },
        "kind": "kit", "kit_id": { "@ref": "kit:flu-vaccination" }, "qty": 1 } ] }
  ] }
```

Adminium reads which tables those are from the add-on's own manifest: a table is one when no
total adds its rows up, it holds no total itself, and every action of the ledger that writes it
writes only such tables. Such a row never fills the link to a posting's receipt.

### Things with no history, and asking the add-on for their stock

An app that keeps its goods in an add-on wants its own goods in its sample: a furniture firm's
desks, not the add-on's own sample. Two more words let the file bring them without typing any
history.

**A row a person could make by hand.** A table the add-on's ledger also writes (Inventory's
`items`, a purchase order) may be brought when a role of the add-on is granted `create` on it:
what somebody makes on a page, a sample may make too. The row leaves out every column the ledger
keeps (an item's average cost, a status the ledger moves) unless it cannot be made without it (an
order line's quantity), and names no receipt, so it arrives as
a thing with no history: an item with no stock, a document still a draft. A table only the ledger
writes (a movement, a level, a reservation) stays refused.

**`moves`.** A list of changes of state, made after the file's rows are in:

```json
{ "format": "adminium.sample/1", "app": "crm", "addOn": "inventory",
  "tables": [
    { "ref": "items", "rows": [{ "@label": "item:desk", "name": "Bench desk, 1400", "sku": "BD-1400" }] },
    { "ref": "receipts", "rows": [{ "@label": "opening", "kind": "opening", "place_id": { "@ref": "place:depot" } }] },
    { "ref": "receipt_lines", "rows": [
      { "receipt_id": { "@ref": "opening" }, "item_id": { "@ref": "item:desk" }, "qty_typed": 24, "unit_cost": "310.00" } ] }
  ],
  "moves": [
    { "ref": "opening", "to": "posting" },
    { "table": "receipt_lines", "to": "posted" },
    { "ref": "opening", "to": "posted" }
  ] }
```

Each move names one row by its label (`ref`) or every row the file wrote of one table (`table`),
and the state it goes to. A move is of a row of the add-on's that this file itself brings, never
of the app's own rows, and a file takes at most 50.

- **Each move is a real save**, made in the order written, by the person who adds the sample: the
  table's own rules judge it (the move must be one the table allows from where the row stands,
  with what it requires), and whatever the add-on's ledger hands to that move runs. In the
  example the add-on itself writes the stock point, the level and the movement, and its totals
  are its own.
- **What the ledger wrote is listed as the app's sample.** "Remove sample data" takes it out with
  the rows that caused it, and a total it fed elsewhere is worked out again.
- **A move that is refused undoes the file.** Its rows, and what earlier moves posted, are taken
  out again, and the add says which move was refused and why. The app's own sample file stays in.
- `moves` are for an app's rows for an add-on only. A manifest's own sample file, an app's or an
  add-on's, writes its rows as they should stand.
