---
title: Filters, search and sort on public lists
description: How an app lets a shopper filter, search, sort and page a list anyone reads, filter it through another list (a product by its variants), count it, and what Adminium refuses.
---

A shop's catalogue page needs more than "the first 50 products": a shopper picks a category and a
price range, types part of a name, sorts by price, and pages on. An app says what a shopper may ask
of a list on the list's own public entry. Everything asked is added on top of the entry's own
`filters`, so a shopper can only narrow what the entry shows. Anything the entry does not name is
refused.

```json
{
  "table": "products",
  "methods": ["GET"],
  "select": ["id", "name", "category", "price", "created_at", "featured"],
  "filters": [{ "column": "status", "op": "eq", "value": "active" }],
  "filterable": ["category", { "column": "price", "ops": ["gte", "lte"] }, "featured"],
  "searchable": ["name"],
  "orderable": ["price", "created_at", "featured", "name"],
  "via": { "entry": "variants", "on": "product_id", "columns": ["colour_code", "size_code"] },
  "count": true,
  "pagination": { "defaultLimit": 24, "maxLimit": 48, "order": "created_at.desc" }
}
```

These words need Adminium 0.3.68 or later: set `compatibility.minAdminiumVersion` to it.

## Which lists may say them

Only a list **anyone reads**: an entry with `GET` and nothing else, no sign-in (`claim`,
`claimedBy`, `visibleWith`, `level`), no code that opens it (`unlockBy`) and nothing withheld from
some readers (`withhold`). Never a table people sign in on or have rows claimed for. A person's own
rows (their orders) keep the order the entry gives them.

Each column named must be one the entry shows (its `select`), and never a code, a secret, personal
data, a file or JSON. On an add-on's entry, never the column that holds the app a row is for
(`appColumn`).

## Filters

`filterable` names up to 8 columns. A column on its own takes `eq`, `in`, `gte` and `lte`; name
`ops` to give it others: `eq`, `in`, `gte`, `lte`, `gt`, `lt`. The page sends a filter in `where`, in
the same grammar as every public list, with these limits:

- conditions are joined by `and` only: an `or` is refused;
- no pattern of the shopper's own: `like` and `ilike` are refused;
- an `in` holds at most 50 values.

```text
GET /api/v1/public/records/<ref>?where={"and":[{"column":"price","op":"gte","value":20},{"column":"price","op":"lte","value":100}]}
```

## Through another list

A product's colour and size live on its variants. `via` lets the page ask about the rows of another
list anyone reads that point at this one:

- `entry` is that list's table, which must have exactly one `GET` entry on the same key;
- `on` is its link to this table;
- `columns` are what may be asked of it, with operators as in `filterable`.

The page sends those conditions in `via`, in the `where` grammar, `and` only. All of them must hold
on **one** of those rows, as that list shows them, its own `filters` included. A product found by
"Slate and M" has one variant that is both, and is active when the variants list shows only active
ones. A product with a Slate S and an Ember M is not found.

```text
GET /api/v1/public/records/<ref>?via={"and":[{"column":"colour_code","op":"eq","value":"slate"},{"column":"size_code","op":"eq","value":"m"}]}
```

Put the codes the page filters by on the other list's own rows (copied from where they are kept),
so the filter is one step.

## Search

`searchable` names up to 4 text columns. `q` finds rows where any of them holds the text, in any
case:

- a search is at least 2 characters;
- `%` and `_` are found as typed, on every database;
- case is folded, accents are not: "cafe" does not find "Café";
- a search is counted on its own, 30 a minute per visitor, apart from the list's other reads.

## Sort and pages

`orderable` names up to 5 columns the page may send in `order`. Each must never be empty, so every
database puts the rows in the same order, and a cursor never stops early. The row's key always
breaks a tie.

- Numbers, dates and yes/no columns sort the same on SQLite, Postgres and MySQL.
- Text sorts by the database's own collation, which differs between them.
- `offset` goes up to 1,000. Page further with `cursor`, which the page gets in `cursor.next`.

`pagination` sets the page size and the order when the page names none. It holds at most 100 rows
a page. Its order column, too, must never be empty and must be one the entry shows.

## A count

With `count`, the first page of the list (no `cursor`, no `offset`) says how many rows match:

```json
{ "data": [ … ], "cursor": { "next": "…" }, "count": { "rows": 47, "atLeast": false } }
```

It counts up to 1,000. Past that it says `{ "rows": 1000, "atLeast": true }`: show it as "1,000+".
Later pages carry no count.

## What the page is told

`GET /public/config` lists each ref's `filterable`, `searchable` and `orderable`, and under
`shopper` the operators each column takes, what may be asked through `via`, and whether the list
counts. A page can build its filters from it.

## What is refused

Every refusal is `400 PUBLIC_QUERY_REFUSED` with `params.parameter` naming the part of the
request: `where`, `via`, `q`, `order` or `offset`. Nothing else about the rows is said.
