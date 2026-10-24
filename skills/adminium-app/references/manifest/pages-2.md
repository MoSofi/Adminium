<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Pages; do not edit -->

# Manifest spec: Pages

| Field | Required | Rule |
|---|---|---|
| `column` | yes | The column of the page's table a card is placed by. With `columnsFrom` it is a link (`"type": "fk"`) to that table. Without `columnsFrom` it is an `enum` column, and the board's columns are its values. |
| `columnsFrom` | no | `{ "table", "label", "order", "badge" }`: the table of the app whose rows are the board's columns, the column of it a board column is headed with, and the column the board's columns are ordered by. `order` may be left out; the columns are then in the order of their key. `badge` is `{ "column", "as" }`: one more column of that table, shown small beside each heading. `as` is `"percent"` (a share kept as a fraction: 0.1 reads "10%"), `"number"`, or `"text"` (the default: as kept, up to 24 characters). |
| `title` | no | The column of the page's table a card is titled with. Left out: the table's own title column. |
| `totals` | no | One or two `{ "column", "fn" }`: a number or money column of the page's table, and `sum` or `avg`. Each column's header shows the figure beside its count. |
| `only` | no | Which rows of the page's table are cards on the board: one to three `"column": value` or `"column": [values]` (up to 20 values each). A row is a card when every column named holds its value, or one of its values. Left out: every row. |
| `card` | no | What a card shows under its title, each from a column of the page's table; at least one of: `link` (`"<link column>.<column>"`: a column of the row the link points at, such as a company's name), `person` (a staff column, `rules.staff`, shown as the person's name), `amount` (a number or money column), `secondAmount` (`{ "column", "label", "labels" }`: a second number or money column, drawn at the end of the amount's line after its short `label`, such as a deal's weighted value "w €1,240"; `labels` gives the label in other languages by their tag; needs `minAdminiumVersion` 0.3.35), `daysSince` (`{ "column", "warnFrom", "alertFrom", "label", "labels" }`: whole days from a date or time column to today; from `warnFrom` days the figure is amber and from `alertFrom` red, both optional, 1 to 3650, `warnFrom` the smaller; `label` says what the days are, after the figure: "12 days in stage", with `labels` by language; the label needs `minAdminiumVersion` 0.3.35) and `date` (a date or time column, shown as a day). A label is 1 to 40 characters, and `labels` needs `label`. |
| `toolbar` | no | `{ "total", "person" }`, at least one (0.3.35): a line drawn above the board. `"total": true` shows how many cards the board holds and each of its `totals` over all of them. `person` (a staff column, `rules.staff`) is a filter: "Everyone" and each person who holds a card on the board. The board's `note` is drawn at the line's end. |
| `note` | no | `{ "text", "texts", "href" }`: one sentence of up to 200 characters drawn above the board; `texts` gives it in other languages by their tag, as a page's `titles` does; with `href`, a path of the workspace starting with one `/` (a page is `/p/<its ref>`), the sentence is a link. |

With `columnsFrom` the board draws one column for each row of that table, a row with no card
too, and reads them when the page opens. A row added, renamed, moved or removed there changes the
board for everybody looking at it who may read that table, about a second later, with no update of
the app; so does a card a colleague saves. A card whose link is empty is on no column. Dropping a card on a column saves that row's key in the card's link, as any save of the
record would: where a role's limit or a state rule refuses the save, the card goes back and the
board shows the reason.

The count and the totals in a column's header are worked out on the server, over the rows the
person may read: a rep held to their own deals sees the count and the worth of their own. Money
is shown in the column's own currency when it has one, else in the install's. A board draws the
first 200 cards of its table; the count is of all of them. It draws the first 100 rows of
`columnsFrom.table` as columns, and says so when that table has more.

Everything `card` draws is read by the server as the person looking, like the headers. The linked
row's column is empty when their roles do not read that table, or do not reach that row. A person
is shown by name and never by id, on the rule of the people list: a signed-in reader is told the
name of somebody who is here or is a sample person; anybody else (suspended, only invited,
removed) is drawn as nobody. The days are counted on the server's clock, on the calendar of where
the business is, so a browser with the wrong date draws the same card; a row with no date has no
figure, and a date still to come counts 0. With `daysSince` the cards are listed longest-waiting
first. The two totals of a header are each named by their column's label ("Amount €12,400 ·
Weighted value €1,240"); a total takes a line of its own where the heading has no room. A role
that may not read the `badge` column sees the board without the badge.

The toolbar's total is the server's, worked out over every card the person may read (their row
limits, and `only`), never a sum of the cards drawn: a board of 340 deals draws 200 cards and its
toolbar counts 340. The person filter offers the people who hold a card the person reads, named as
the people list names them, the most cards first (30 at most); a card with nobody in the column is
among "Everyone" only. Choosing a person narrows the cards, each column's count and totals, and
the toolbar's total to that person's cards, still within what the person looking may read: a rep
held to their own deals who chooses a colleague sees no card. The choice holds while the page is
open.

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
