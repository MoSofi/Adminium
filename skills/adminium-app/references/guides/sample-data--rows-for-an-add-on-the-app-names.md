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
