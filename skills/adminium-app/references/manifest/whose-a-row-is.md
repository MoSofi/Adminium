<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Whose a row is; do not edit -->

# Manifest spec: Whose a row is

A role can be held to some rows of a table (see [Whose a row is](https://docs.adminium.dev/guides/apps/whose-a-row-is/)).
Five words say how. They need Adminium 0.3.27.

**A staff column** holds a staff member's id. It is a text column, and the only kind of column
a person is read from:

```json
{ "ref": "owner_id", "type": "text", "maxLength": 36, "nullable": true, "rules": { "staff": true } }
```

**`belongs`**, on a table, lists the ways a person belongs to one of its rows. Any one is enough:

```json
"belongs": [
  { "column": "owner_id", "set": "team" },
  { "through": { "table": "deal_members", "link": "deal_id", "user": "user_id" } },
  { "through": { "table": "covers", "link": "owner_id", "on": "owner_id", "user": "cover_id", "from": "starts_on", "to": "ends_on" } },
  { "via": "company_id" }
]
```

| Way | Fields |
|---|---|
| a column | `column`: a staff column of this table. `set` says whom a writer limited on the table may put there: `self` (the default: only themselves), `team` (somebody in a team they lead) or `anyone`. With `person`, `column` is instead a link to a row of the app, and `person` names the staff column on that row (a ticket's `assignee_id` to an agent's `user_id`). |
| a listing | `through`: `table` lists people against rows; `link` is the listing's column that equals this row's key, or this row's `on` column when it is not the key; `user` is the listing's staff column (or, with `person`, a link to a row that holds one). `from` and `to` are date columns of the listing: the listing counts from the first to the second, by the business's day, and either may be empty. |
| a parent | `via`: a link of this table. Whoever reaches the row it points at reaches this one. |

A row is reached through at most two links (`via` of a table that is itself reached `via`
another). The listing a way goes through cannot itself be reached through the table it lists
for. Each staff column a way names, and each link a `via` follows, should be first in one of the
table's [`indexes`](https://docs.adminium.dev/reference/manifest/#tables): a limited list is as fast as an unlimited one with the index, and
several times slower without it.

**`private`**, on a table, with a `belongs` of plain staff columns only (no `via`, `through` or
`person`): its rows are read by their own people and by nothing else. Nothing may be reached
through a private table, no total of its rows is kept elsewhere, and it is not exported,
imported, reported on a schedule, drawn into a document, read by a rule or handed to an owner's
code. An update of the app is the only thing that sets or removes the mark.

**`rows`**, in a role's [`limits`](https://docs.adminium.dev/reference/manifest/#roles) for a table, says which rows its read, update and
delete reach, each on its own:

```json
"limits": { "deals": { "rows": { "read": { "reach": "team", "unowned": true }, "update": { "reach": "own" } } } }
```

`reach` is `own`, `team` or `all`; `unowned: true` adds the rows nobody belongs to; `while`
(`{ "column", "in": [...] }`) holds the reach to rows whose column has one of those values now,
and `all` is written only with a `while`. An action left out reaches every row. The table must
declare `belongs`. A manifest is refused when a role holds a limit on a table of which another
table keeps a stored total (a [`rollup`](https://docs.adminium.dev/reference/manifest/#column-rules)), unless that table is reached `via` the
very link the total adds up by.

**`handOver`**, on one of a table's [`states.actions`](https://docs.adminium.dev/reference/manifest/#states), marks the one write in which a
person limited to their own rows may name a colleague: the button asks for a staff column and
sets it to anybody.

```json
{ "id": "hand-over", "label": { "en-US": "Hand over" }, "set": {}, "in": ["open"], "ask": ["owner_id"], "handOver": true }
```
