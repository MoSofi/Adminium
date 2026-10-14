<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — outbox; do not edit -->

# Manifest spec: Emails — outbox

`where` is one condition on the source row: `{ "column", "eq" }`, `{ "column", "in": [values] }`
or `{ "column", "isNull": true|false }`, exactly one of the three. `before.lead` is
`{ "via", "table", "column", "fallback"?, "max" }`: the number of hours before, read from `column`
(an `int`) of the row that `via` points at, else from the settings `fallback`, and never more
than `max` hours (1–336). `max` is also how far ahead Adminium looks. A reminder is queued with
its moment in `columns.due`.

A source row produces each kind once, unless its producer says `repeat` or `repeatBy`. A reminder
is produced again only when its moment moves; a batched message, once its window has closed. An
undo of a change is heard by the producers of `"changed": true` alone, so the dates it puts back are
mailed; a `{ "column", "to" }` producer never fires on an undo. Sample data and imports fire no
producer when they are written. A sample row never has a message at all. An imported row is a real one, so the
minute's look-over still makes its `before` reminder when the moment comes, and a held producer's
messages for it (an imported sent invoice gets its reminders).

A message row an import or an undo brings back never goes by itself: nothing here made it and
nobody approved it. One that arrives `queued` comes in `held` for a person to approve, or `failed`
with a sentence saying why where the outbox has no `held` (queue it again to send it); one that
says it went, with a sent time and no error, comes in `sent`.
