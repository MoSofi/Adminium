<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § Several limits on one table; do not edit -->

# Booking rules and limits: Several limits on one table

A table may carry up to three rules, as a list. At most one of them is a slot limit. Each is
judged on its own: the stay above must fit both its room type and its room.

### Which rows count

`countWhere` says which rows take from the pool. It is one condition, or a list of two: one on the
row itself and one on the row it belongs to, through `via`. A ticket counts while it is valid,
returned or checked in, and while its order is held or paid. Without `countWhere`, every row
counts.

A rule reads one owner: every `via` in its conditions, hold and day is the same foreign key.

Two cases count on the side that never oversells:

- A row created without its state column counts, as the column's default may be a counted one.
- A row whose owner link is empty counts.

A row that counts always takes more than nothing. A party of zero or less is refused
`out-of-range`, never counted as places given back.
