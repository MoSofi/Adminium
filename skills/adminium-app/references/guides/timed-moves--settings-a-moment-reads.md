<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md § Settings a moment reads; do not edit -->

# Timed moves on the venue's clock: Settings a moment reads

A setting written `{table, column}` is read from **one** row. Otherwise which row is "the"
settings is anybody's guess, such as another guest's arrival time. So every setting in a manifest
must name either:

- the app's settings table, the outbox's `settings.table`, or
- a table standing alone: it has no foreign key of its own, no table points at it, and it keeps no
  states, limits or booking rule.

Anything else is refused by the manifest check. A stay's own arrival time read as a setting gets:

> "stays" may hold many rows, so "stays.arrival_time" is no setting: read settings from the app's
> one-row settings table (outbox.settings.table), or from a table that links nowhere, that no table
> links to, and that keeps no states or limits

A time kept on each stay is written `"time": {"column": "arrival_time"}` instead.

If a settings table is found holding two rows, a moment, a move's setting condition or a stamp's
amount reads no setting from it at all. The moment has no value, so a timed move reading it waits,
and a move waiting for the setting is refused. Keep one row there.
