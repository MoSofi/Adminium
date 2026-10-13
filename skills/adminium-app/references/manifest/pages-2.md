<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Pages; do not edit -->

# Manifest spec: Pages

`only` makes the board a board of some of its table's rows: `"only": { "state": "open" }` is the
open deals, `"only": { "kind": ["new", "renewal"], "hot": true }` the hot deals of two kinds. It
holds for the cards and for the headers alike, so a column's count and totals are of the cards
`only` keeps. A column of `only` is an `enum`, a `bool`, a link (`fk`, by the key it holds),
`text` or a whole number (`int`, `bigint`) of the page's table, and not the board's own `column`;
a value of an `enum` is one of its values, and a value of a link is of the kind the table it links
to is keyed by: a whole number for an `int` or `bigint` key, text for any other. A card added on
the board is given each value `only` names alone (`"state": "open"`, not a list), so it is on the
board; where the table's own rules refuse that value for a new row, the add is refused and the
board says why. A role that may not read a column `only` names (it is
not among the role's `readable` columns, or it is personal data the role may not read) gets
neither the cards nor the figures: the headers show no count and no total, never those of every
row. So name a column every role that opens the board may read.

The manifest is refused when `column` is not a link to `columnsFrom.table` (or, with no
`columnsFrom`, not an `enum`), when a name is not a column of the right table, when a total is not
a number or money column, when `only` names the board's own `column`, a column of another type
or a value its column cannot hold, and on a page that is not a `page-board`. The install checks the
same against the tables as they really are: a board that cannot be built as named is not built as
another one. Its page is created empty and the install reports why (`PAGE_BOARD_INVALID`).
Without `board`, a board's columns are the values of the workflow column Adminium finds, as
described under
[A board with its own columns](https://docs.adminium.dev/guides/apps/manifest-by-task/#a-board-with-its-own-columns).

**Links that open a list filtered.** A link in a layout (a metric card's `href`, the toolbar's
`link`) may open a records page on some of its rows: `/p/<page ref>?f.<column>=<op>:<value>`, with
one `f.` piece per column, up to 8. "Overdue" leads to
`/p/studio-invoices?f.status=eq:sent&f.due_on=before:today`, and the page shows a chip for each
piece.

| Piece | Rows it keeps |
|---|---|
| `eq:<v>`, `neq:<v>`, `in:<a,b>` | The value, not the value, or one of up to 50 values. |
| `gt:`, `gte:`, `lt:`, `lte:` | A number, or a day. |
| `before:<day>`, `after:<day>` | A date or time before or after that day. |
| `before:now`, `after:now` | A time before or after this moment. |
| `month:this`, `month:last` | A date or time in this or last month. |
| `set`, `unset` | Has a value, or has none. |

A day is `YYYY-MM-DD`, `today`, or a whole number of days from it: `today-30`, `today+7` (at most
3660 either way). Days are the venue's: on a time column a day is the whole day where the venue
is. `now` is for time columns only. The pieces are worked out on the server when the page opens,
so `today` is always the day it is read. A piece the column cannot take (an unknown column, a
personal column the reader may not see, `gt` on a yes/no, a value that is not a number) is left
out, and its chip says so; the page never fails.

**Updates.** A page nobody has edited is rebuilt when the app is updated. A page the operator
edited is left as they left it. Uninstalling an app does not delete its pages.
