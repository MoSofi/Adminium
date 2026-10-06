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
loaded. An app never ships rows for an add-on's ledger: what was counted is the add-on's to write.
