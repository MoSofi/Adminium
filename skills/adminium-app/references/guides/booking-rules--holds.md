<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § Holds; do not edit -->

# Booking rules and limits: Holds

A checkout holds places while the guest pays. `hold` makes a row count only while its hold has not
ended, and only while its state is one of `hold.states`. A paid order counts whatever its old hold
says. See [Holds](https://docs.adminium.dev/reference/manifest/#holds).

```json
"hold": { "column": "held_until", "states": ["held"], "via": "order_id" }
```

| Field | Rule |
|---|---|
| `column` | Where the hold ends: a `timestamptz` column of the row (or of its owner with `via`), or `{ "column", "via", "or" }` read through a link. |
| `states` | The states that are held. Each must be a counted state. |
| `via` | Read the state and the end on the row this row belongs to (the order of a ticket). |

The end must be a column Adminium stamps, never one a guest writes. Give it a stamp, for example
ten minutes from the create, never later than the doors open:

```json
{
  "ref": "held_until",
  "type": "timestamptz",
  "nullable": true,
  "rules": {
    "stamp": {
      "set": { "addMinutes": { "minutes": { "table": "settings", "column": "hold_minutes" }, "notAfter": { "via": "event_id", "column": "doors_at" } } },
      "on": "create"
    }
  }
}
```

Nothing else may watch that column: no other stamp, no code renewal and no copy that follows it.
A new hold writes it directly as it lets the old one go, and no rule runs on that write.

A hold with an empty end holds. A hold whose end has passed stops counting at once, by the clock,
whether or not a timed move has marked the row expired yet.

**A hold read through a link.** An order made from a waitlist offer is held until the offer ends,
and otherwise until its own end. `column.via` is a foreign key of the row the hold reads, and the
first end of `or` that is filled answers when the link is empty:

```json
"hold": {
  "column": { "column": "offer_until", "via": "waitlist_id", "or": [{ "column": "held_until" }] },
  "states": ["held"],
  "via": "order_id"
}
```

### Places kept for the waitlist

`reserved` keeps places that came back, such as a returned ticket, counted against the public
while staff decide who gets them. Staff do not count them, so the desk can sell or offer them.
Its states must be counted ones and not also held. It belongs to parent limits.

```json
"reserved": { "states": ["returned"] }
```

An order that leaves its hold for a paid state takes no new place. It is counted as staff count,
so the places kept back for the waitlist it was offered are not counted against it twice.

Those kept places are the ones the claim took, so with `releaseTo` they move on in the same write:
as many kept rows of the pool as places the claim takes, oldest first, move to that state (one of
the pool row's own states, not kept). The public then counts what is truly left, and the box
office's "back for the waitlist" count says only what is still to offer.

```json
"reserved": { "states": ["returned"], "releaseTo": "released" }
```

### One live hold per guest

A guest who goes back and changes their tickets makes a new hold. The old one is let go in the same
write, rather than counted until its time runs out. Adminium finds the old hold only through proof,
never a typed address:

- **The page's own link.** A create answers the new row's own link and a session on it. The page
  sends that session back as `replaces` with its next create. The session then moves to the new
  hold. This needs the create entry's `shareLink`.
- **A signed-in guest.** A guest with a verified session has their other live holds let go.

A hold let go has its end moved to one second before the new write began. Only a hold whose end is
a column of the row itself can be let go. A dry run with `replaces` judges the old places as let
go, and writes nothing.
