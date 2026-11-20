---
'@adminium/manifest': patch
'@adminium/server': patch
---

A list anyone reads may now let a shopper filter, search, sort, page and count it, declared on the app's own public entry: `filterable` (up to 8 columns, each with the operators it takes: `eq`, `in`, `gte`, `lte`, `gt`, `lt`), `searchable` (up to 4 text columns), `orderable` (up to 5 columns that are never empty), `via` (conditions on another list's rows that point at this one, a product's variants, all held by one of those rows under that list's own filters) and `count` (the first page says how many rows match, to 1,000). An `or`, a pattern of the shopper's own and an `in` of more than 50 values are refused; a search is at least two characters and counted on its own, 30 a minute; an offset goes up to 1,000. Only a list anyone reads may say them, never of a person's table, a code, a secret, personal data, a file or JSON, nor an add-on's app column. Any app may now set its entries' page size and order (`pagination`, at most 100 a page). Needs 0.3.68.

The quick search (`q`) now finds `%` and `_` as typed on every database, the dashboard's search included: on SQLite a search for "100%" found nothing.
