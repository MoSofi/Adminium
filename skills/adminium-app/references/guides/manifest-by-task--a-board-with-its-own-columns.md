<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § A board with its own columns; do not edit -->

# A manifest, task by task: A board with its own columns

A board's page may say what its columns are, with `config.board`. There are two ways, and which
one is right depends on who must be able to change the list.

**The columns are rows of a table.** Use this when the people who run the business must be able
to add a column, rename one or put them in another order: the stages of a sales pipeline, the
steps of a workshop. Keep the list in a table of its own and link each card to a row of it:

```json title="manifest/tables/stages.json"
{ "ref": "stages", "columns": [
  { "ref": "id", "type": "int", "role": "pk" },
  { "ref": "name", "type": "text", "maxLength": 80 },
  { "ref": "position", "type": "int" }
] }
```

```json title="manifest/tables/deals.json (one column)"
{ "ref": "stage_id", "type": "fk", "references": "stages", "nullable": true }
```

```json title="manifest/pages.json"
{
  "ref": "sales-pipeline",
  "template": "page-board",
  "title": { "key": "sales.pipeline", "fallback": "Pipeline" },
  "nav": { "group": "main", "icon": "square-kanban", "order": 1 },
  "bindings": { "rows": "deals" },
  "config": { "board": {
    "column": "stage_id",
    "columnsFrom": { "table": "stages", "label": "name", "order": "position" },
    "title": "name",
    "totals": [{ "column": "amount", "fn": "sum" }]
  } }
}
```

The board has one column for each row of `stages`, in the order of `position`, a stage with no
deal too. Each header shows how many deals the stage holds and what they are worth, counted on
the server over the deals the person may read. A stage somebody adds is a column within about a
second, for everybody who has the board open, with no update of the app. Give the app a records page over `stages`, so its people
can keep the list, and give each role `table:@stages:read`.

**The columns are the values of a choice column.** Use this when the list is fixed and the app's
rules hang on it: a deal that is open, won or lost, with [states](https://docs.adminium.dev/reference/manifest/#states)
that say which moves are allowed. Name the column, and any `enum` will do, whatever its values:

```json
"config": { "board": { "column": "state" } }
```

A table may have both: a `stage_id` its team arranges as it likes, and a `state` the app's rules
read. Put the board on the stages and keep the rules on the state.

- **A drop is an ordinary save.** It writes the card's link (or its choice), so a role's limit and
  a state rule apply to it as to any save. A refused drop puts the card back and shows the reason.
- `title` and `totals` may be left out. A total is a number or money column of the cards' table,
  `sum` or `avg`, two at most.
- **A board of some of the rows.** A pipeline is the open deals, not every deal ever made. Add
  `"only": { "state": "open" }` to `board` and a won or lost deal is no card, and each header counts
  and totals the open deals only. `only` takes one to three columns of the cards' table, each with
  a value or a list of values (`"only": { "kind": ["new", "renewal"] }`): a choice, a yes/no, a
  link, text or a whole number, and not the column the board is arranged by. A link takes the key
  of the row it points at, as that table keeps it: `7` for a table keyed by a whole number, never
  `"7"`. Every role that opens the board must be able to read those columns, or its headers show
  no figures.
- **A card added on such a board is one of its cards.** It is given each value `only` names alone
  (`"state": "open"`). A board of the won deals, over deals that must start open, cannot take a
  new card: the add is refused, the board says why and keeps what was typed.
- It needs `"minAdminiumVersion": "0.3.28"`.

Reference: [Pages](https://docs.adminium.dev/reference/manifest/#pages).
