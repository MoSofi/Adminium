<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Whose a row is; do not edit -->

# Manifest spec: Whose a row is

`reach` is `own` (the parent names the person) or `team` (the person, or somebody they lead);
`unowned` is not taken. `via` must be one of the table's own `belongs` links and `by` a staff
column (`rules.staff`) of the table it points at. It holds on every door a reach holds on: the
list and the record (another team's visit is a row that is not there, `404`), a change, a new
row (hung only under a parent whose `by` names them or somebody they lead, else `403` reason
`parent-not-theirs`, whoever the new row names), a dashboard figure (worked out again as soon as
the parent changes hands), a file out, the live frames (a bare "this table changed", never a
row) and the role editor's count. It is opt-in: a reach without `via` reads the table's every
way as before (a helper listed on the deal, the visit's own rep). Needs Adminium 0.3.35
(`rows.via`).

**`notThrough`**, on an update or a delete reach, names a listing the reach does not count: a
`through` way whose `table` is that listing makes no row the person's for this reach, on the
table itself or on a row it hangs off (`via`, up to two links up). Every other way counts as
before: a staff column, another listing, the rows nobody owns. A helper listed on a deal
(`deal_members`) reads the deal, its quotes, their lines and its visits, and comments on them,
and changes none of them; whoever covers for the deal's owner (`covers`), and the owner, change
them as they always did:

```json
"limits": {
  "deals":       { "rows": { "read": { "reach": "own" }, "update": { "reach": "own", "notThrough": "deal_members" } } },
  "quotes":      { "rows": { "read": { "reach": "own" }, "update": { "reach": "own", "notThrough": "deal_members" } } },
  "quote_lines": { "rows": { "read": { "reach": "own" }, "delete": { "reach": "own", "notThrough": "deal_members" } } },
  "follow_ups":  { "rows": { "read": { "reach": "own" }, "update": { "reach": "own", "by": "owner_id", "notThrough": "deal_members" } } } }
```

It is one listing's ref, or a list of one to four. Each must be the `table` of a `through` way of
this table, or of a table it hangs off by `via` (two links at most); it is refused on a read (a
person listed on a row still reads it), beside `via` (that reach counts no listing already), with
`reach: all`, on a private table, and on a grant on an add-on's table. It holds on every door an
update or a delete reach holds on (a change on a page, a child row saved with it, a bulk edit, a
file brought in, a record's button, a document): a row it leaves out is a row that is not there to
them (`404`). A new row hung under a parent (a quote of the deal, a follow-up or a visit on it) is
judged by the parent without the listing too, `403` reason `parent-not-theirs`: where every reach
of the writer on the new row's table leaves a listing out, a staff column of the new row that
names the writer does not make it theirs while it is hung under a parent. A row hung under no
parent is theirs by its own column as before, and a row of theirs made before is changed and
removed as before. The role editor keeps it through a save and says it in words ("but not as
someone listed in Deal members"). Needs Adminium 0.3.36 (`rows.notThrough`).

An action may name **several reaches**, as a list of one to four: any one of them is enough, and
each is its own whole test (its `while`, `unowned` and `by` hold for it alone), as two roles'
reaches are. An account manager reads every won deal, and an open one only while he is listed on
it:

```json
"limits": { "deals": { "rows": { "read": [
  { "reach": "all", "while": { "column": "state", "in": ["won"] } },
  { "reach": "own" } ] } } }
```

No reach of the list is written twice, and the checks above hold for each. A private table's
reach stays `{ "reach": "own" }` alone. A list needs Adminium 0.3.28.

A row of a table reached through its parent (`via`) is hung, by a writer held to some rows of it,
only under a parent their reach of THAT table reaches: a parent that is theirs (or somebody's
they lead, with `team`), or nobody's when the reach takes `unowned` rows. Reading the parent is
not enough: the account manager above reads every won deal and comments only on a deal he is on
(403, reason `parent-not-theirs`). A row a staff column of its own names them in (a stamp of
its maker, say) is theirs whatever its parent, unless every reach of theirs on the table leaves a
listing out (`notThrough`, above); a table that also lists people `through`, or reads a person
from a linked row, is not judged this way.

Apart from any limit, **the columns that decide whose a row is** (the staff columns the table's
own `belongs` names) are changed only by somebody the stored row names in one of them, or who
leads that person where the role's reach is `team`. Somebody who reaches the row another way (a
helper listed on it, a cover, the owner of its parent) works on the row and cannot give it away
or take it. A record's `handOver` button frees whom the row may go to, not who may hand it over.

Where such a column is kept as a copy of the row's parent (`copy` with `mode: "always"`), the
person is decided by the link: a writer held to some rows sets that link only to a parent that
names them there (or somebody they lead, with `set: "team"`), and is refused 403 with reason
`parent-not-theirs` otherwise. And the person column of a table that another table's `belongs`
reads `through` takes only somebody who reads at least one of those tables (422, the field
marked `cannot-open`), whoever writes: a person on the dashboard, a bulk edit, an import (by
somebody nothing limits too), a rule's write step, the row an effect moves, a timed move, and
the owner's code. Every one of them is judged on the row as its rules leave it, a person's own
change and new row included (from 0.3.35), so a stamp that puts a person into such a column (its
writer, or a person copied from another column) is held to the same. See
[Whose a row is](https://docs.adminium.dev/guides/apps/whose-a-row-is/).

**`handOver`**, on one of a table's [`states.actions`](https://docs.adminium.dev/reference/manifest/#states), marks the one write in which a
person limited to their own rows may name a colleague: the button asks for a staff column and
sets it to anybody.

```json
{ "id": "hand-over", "label": { "en-US": "Hand over" }, "set": {}, "in": ["open"], "ask": ["owner_id"], "handOver": true }
```

Anybody, that is, who can work the row: an active person whose roles read and change the table,
with a reach that holds the row in the state it is in (an account manager who reaches a deal
once it is won is not given an open one). Anyone else is refused 422, the field marked
`cannot-open`. A writer held to some rows who names somebody by a plain change, in a column
whose `belongs` way says `set: "anyone"`, is held to the same: the button is not the only door
to the column.

**`carries`**, beside `handOver`, moves the old person's child rows to the new one in the
hand-over's own write: a deal handed over takes its owner's booked visits and open follow-ups
along, and leaves a visit already made, and a colleague's rows on the deal, where they are.

```json
{ "id": "hand-over", "label": { "en-US": "Hand over" }, "set": {}, "in": ["open"], "ask": ["owner_id"], "handOver": true,
  "carries": [
    { "table": "site_visits", "via": "deal_id", "column": "rep_id", "where": [{ "column": "state", "in": ["booked"] }] },
    { "table": "follow_ups", "via": "deal_id", "column": "owner_id", "where": [{ "column": "done", "eq": false }] } ] }
```
