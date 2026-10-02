<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md § Moments; do not edit -->

# Timed moves on the venue's clock: Moments

Every rule that reads a point in time reads it the same way: a timed move's `at`, a move that
[waits for a time](https://docs.adminium.dev/guides/apps/timed-moves/#moves-that-wait-for-a-time), a [late move](https://docs.adminium.dev/guides/apps/timed-moves/#late-moves), a stamp's deadline, a
guest's window. That shape is a **moment**
([reference](https://docs.adminium.dev/reference/manifest/#moments)).

| Part | Rule |
|---|---|
| `column` | A `date` or `timestamptz` column. A date has no clock, so it needs a `time`. |
| `via` | This row's foreign key: the moment is read from the row it points at. Not in a timed move's `at`. |
| `time` | A wall time on the column's day. See [below](https://docs.adminium.dev/guides/apps/timed-moves/#time-of-day). |
| `plus` or `minus` | A shift of exactly one of `minutes`, `hours` or `days`. Each is a whole number, or a whole-number column of the settings row. Never both `plus` and `minus`. |
| `or` | Up to three moments read in turn when this one has no value. |

### Time of day

`time` puts the moment at a wall time on the column's day. For a `timestamptz` column that day is
the venue's day of the stored instant: a 12:30 pickup on Friday reads Friday.

| `time` | Example | Reads |
|---|---|---|
| `"HH:MM"` | `"10:00"` | That wall time. |
| A setting | `{ "table": "settings", "column": "no_show_at" }` | A text column of the settings row holding `HH:MM`. It must hold at least 5 characters. |
| An opening-hours edge | `{ "hours": { … }, "edge": "closes" }` | The venue's opening (`opens`) or closing (`closes`) hour that weekday, from a weekly hours table. |
| A time kept on the row | `{ "column": "arrival_time" }` | A text column of the same row (of the linked row, with `via`): the arrival time a guest gave. |

The hours table has one row per weekday: an enum of `mon` to `sun`, text `HH:MM` times, and
optionally a yes/no that the venue is open that day. A closed day, or a weekday with no row, ends
at midnight: an order for a closed Monday is cancelled at the end of Monday. A closing hour at or
before the opening hour is past midnight, on the next day's clock. Two rows for one weekday say two
things, so neither is read and that day's moment has no value.

A time kept on the row may be written `HH:MM`, `H:MM` as a person types it, or `HH:MM:SS` as a
database keeps it. Anything else, or an empty column, is no moment.

### Shifts

**Minutes and hours are elapsed time.** 48 hours before 15:00 is 48 real hours earlier, whatever the
clocks did in between. **Days are calendar days** at the same wall time: one day after 10:00 on
Saturday is 10:00 on Sunday, even on the night the clocks go back.

A shift read from a setting that is empty, negative or not a number is no shift: the moment has no
value.

### A moment with no value

A moment whose column is empty, whose linked row is missing, or whose setting cannot be read has no
value. Its `or` moments are read in turn, and the first one that answers stands in:

```json
"at": {
  "column": "offer_until",
  "or": [{ "column": "valid_to", "minus": { "hours": { "table": "settings", "column": "offer_hours" } } }]
}
```

What no value means is the reading rule's: a timed move never fires, a move waiting for the time is
refused, a late rule is not late.
