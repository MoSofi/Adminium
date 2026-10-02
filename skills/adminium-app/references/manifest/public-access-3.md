<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access; do not edit -->

# Manifest spec: Public access

`writableValues` and `writableWhen` pin both ends of a change: `status` may become `cancelled`,
and only while it is `booked`. `writableWhen` is part of the change itself, never of a read, so a
finished visit still lists but cannot be moved; a change to a row in any other state answers as if
the row were not there. An entry with `claimedBy` that changes an enum column must list its
`writableValues`: permission to cancel is not permission to mark a visit seen.

A `null` in `writableWhen` pins a value that may be written once: `"signed_name": [null]` takes a
signature while the column is still empty, and never changes it after. The calendar words pin a
date: a proposal still in date may be accepted (`"valid_until": "from-today"`), and one past it may
ask for a new price (`"before-today"`). `"before-today"` takes a `date` column only, never a time,
and the same entry may not write that date: a caller who could move it forward would put the row
back in date on its old terms.

A window lets a change wait for its time: `"starts_at": { "within": 60 }` takes a check-in up to an
hour before the visit, or any time after it. A change asked for earlier is refused `409`
`PUBLIC_TOO_EARLY`, and the reply's `params` carry `at`, the row's time, and `from`, when the window
opens, both as instants — even when `select` leaves the column out; naming the window agrees to
that. The refusal is said only for a row the caller's own read reaches, with every other state in
`writableWhen` met; any other miss answers as if the row were not there.

`confirm` takes `template` (only `booking-confirmation` today), `to` (the column holding the
guest's address) and optionally `code`, `when`, `party` and `name` (columns the email shows),
`venue` (`{ "table", "name"?, "address"?, "phone"? }`, the app's one-row venue table) and `link`
(a path under the customer side, up to 200 characters).

A file in `files` stays private: a browser downloads it only at
`GET /api/v1/public/files/<ref>/<row>/<column>` (`<ref>` is the entry's endpoint), which reads the
row exactly as the entry's list would (its filters, its claim, its parent), then serves the file
that column names, from the key's own database. A row the session cannot reach, an empty column
or a link to somewhere else serves nothing (`404`), and no other public route serves a file.

An `availability` entry answers free or full and never returns a row. It is `GET` only, and the
table must declare a [`capacity`](https://docs.adminium.dev/reference/manifest/#capacity) or a [`booking`](https://docs.adminium.dev/reference/manifest/#booking). On a capacity table it
answers by the limit's kind; see [Availability](https://docs.adminium.dev/reference/manifest/#availability). On a booking table it answers the
times of a day, or a strip of up to 31 days, for a kind and optionally a person; a guest is offered
only people bookable online, and is never told who. An availability entry reads no rows, so it is
never the parent another entry is [visible with](https://docs.adminium.dev/reference/manifest/#rows-visible-with-their-parent).

The install's check step lists every endpoint it will create, and warns about anything that would
stop the key working, such as the public API being off or no time zone set on the database.
