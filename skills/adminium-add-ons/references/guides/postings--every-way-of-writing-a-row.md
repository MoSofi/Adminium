<!-- produced from apps/docs/src/content/docs/guides/apps/postings.md § Every way of writing a row; do not edit -->

# Rows that post into an add-on's ledger: Every way of writing a row

A rule fires on a save of **one row**, and on a create of a row with its child rows. Everything
that writes many rows in one go is refused when one of them would fire a rule, change what an open
round read, or delete a row with an open round — rather than write rows the ledger never heard of.

| Way in | A rule fires |
|---|---|
| A create, a change, a button on a record; a create with child rows | yes |
| A guest's create or change through an app's [public access](https://docs.adminium.dev/guides/apps/public-access/) | yes |
| A [timed move](https://docs.adminium.dev/guides/apps/timed-moves/), an automation's step, project code | yes |
| `POST /data/:connection/:table/one-by-one` | yes, one save a row |
| A bulk edit, an [undo](https://docs.adminium.dev/guides/apps/undo-a-status-move/), a form's child rows, a public batch, a [state's effect](https://docs.adminium.dev/reference/manifest/#states) on another row | no: `409 POSTING_REFUSED {reason: "one-at-a-time"}` when it would |
| An import, sample data | a new row is history: nothing is posted and nothing refused. A change of a stored row that would post is that row's own refusal, and the import goes on |
| A row the add-on's own code writes | never: its tables' own rules do not fire on it |

A list page's bulk change that is refused this way is sent again row by row through the
one-by-one route, and says what became of each.

A save that posted cannot be undone with an Undo: its reply carries no undo token. The rule's
`reverse` point is the way back.
