<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Pages; do not edit -->

# Manifest spec: Pages

The manifest is refused when `column` is not a link to `columnsFrom.table` (or, with no
`columnsFrom`, not an `enum`), when a name is not a column of the right table, when a total is not
a number or money column, when `only` names the board's own `column`, a column of another type
or a value its column cannot hold, and on a page that is not a `page-board`. Without `board`, a board's
columns are the values of the workflow column Adminium finds, as described under
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
