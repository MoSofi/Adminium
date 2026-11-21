<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Booking; do not edit -->

# Manifest spec: requiredSchema — Booking

- `when` is `{ "column", "values" }`: the states that go out. Name them, because a counted state may
  not be one for a calendar: a booking still being paid for holds its time and is on nobody's phone.
- `calendarName` is the calendar Adminium makes, as text or `{ "table", "column" }` of the settings
  row.
- `title` is `{ "service", "person"? }`, each a text column or `fk.column` one link away.
- `detail` is `{ "default", "max" }`, each `"first-name+initial"` or `"none"`. `max` is the most a
  person's own setting may choose. Without it, first name and initial ("Ava R.", or "Cher" for a
  one-word name). The morning after a visit the title becomes the service alone, and when a person
  is forgotten or erased, every event of theirs is written again without the name.

`anyone.pick` is `"order"`, `"even"`, or `{ "column" }`, an enum of those two on the kind's table,
so each kind can choose. `even` gives the time to the free person with the fewest counted rows that
day, then the one whose last row was made longest ago (`made`, a `timestamptz` of this table,
required unless the pick is `"order"`), then the order. `flag` is a bool of this table that Adminium
sets: true when it picked the person, false once a write names one. No writer can set it. A booking
moved with its person emptied keeps that person when they are free.

Nothing may start in the past, with one exception: staff may create a walk-in in the slot that
holds the current time, when its status is a counted value other than the first in `countWhere`
(`checked_in` rather than `booked`).

The public API answers a clash with `PUBLIC_SLOT_FULL`; a time outside hours, on a closure,
beyond the window or with nobody offered for the kind with `PUBLIC_WRITE_REFUSED`; and a guest's
late move, or a late cancellation in `refuse` mode, with `PUBLIC_TOO_LATE`. An
[`availability`](https://docs.adminium.dev/reference/manifest/#public-access) entry on a booking table lists the free times of a day, or a
strip of days, for a kind.
