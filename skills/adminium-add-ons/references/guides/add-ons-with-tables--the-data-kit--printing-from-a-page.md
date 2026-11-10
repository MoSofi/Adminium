<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md § The data kit — Printing from a page; do not edit -->

# Add-ons that keep tables of their own: The data kit — Printing from a page

### Printing from a page

`useDocument().open(kind, table, key, options?)` draws one of the add-on's
[documents](https://docs.adminium.dev/reference/manifest/#documents) for a row of one of its tables and opens it;
`{ "print": true }` opens the print dialog, and `paper` picks one of the papers the kind lists
(`a4`, `letter`, `receipt-80mm`, `a6`). The reader must be able to read everything the document
reads. A document that prints a [money code](https://docs.adminium.dev/reference/manifest/#documents-that-print-a-money-code)
is kept nowhere, so it is not in the documents register: pass the `once` ticket the create
answered to print the code that was shown once.
