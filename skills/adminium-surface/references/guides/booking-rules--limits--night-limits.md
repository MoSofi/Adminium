<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § Limits — Night limits; do not edit -->

# Booking rules and limits: Limits — Night limits

### Night limits

A guest house sells its rooms by the night. A stay takes one room of its type on every night from
its arrival to the night before it leaves. The pool is the number of rooms of that type, less those
out of service that night. A second rule keeps each room to one stay a night. Parking is an extra
with its own limit, taken on the stay's nights. See [Night limits](https://docs.adminium.dev/reference/manifest/#night-limits).

```json
"capacity": [
  {
    "kind": "night",
    "from": "arrive",
    "to": "depart",
    "countWhere": { "column": "status", "values": ["held", "booked", "in_house"] },
    "pool": {
      "via": "room_type_id",
      "count": {
        "table": "rooms",
        "column": "room_type_id",
        "outOfService": { "table": "room_closures", "room": "room_id", "from": "from_date", "to": "to_date", "active": "active" }
      },
      "fits": { "column": "sleeps" },
      "given": { "via": "room_id", "column": "room_type_id" }
    },
    "nights": { "min": 1, "max": { "table": "settings", "column": "max_nights" }, "minByArrival": { "sat": 2 }, "aheadDays": { "table": "settings", "column": "ahead_days" } },
    "hold": { "column": "held_until", "states": ["held"] },
    "arrived": { "states": ["in_house"] }
  },
  {
    "kind": "night",
    "from": "arrive",
    "to": "depart",
    "countWhere": { "column": "status", "values": ["held", "booked", "in_house"] },
    "pool": {
      "via": "room_id",
      "size": 1,
      "outOfService": { "table": "room_closures", "room": "room_id", "from": "from_date", "to": "to_date", "active": "active" }
    },
    "hold": { "column": "held_until", "states": ["held"] },
    "arrived": { "states": ["in_house"] }
  }
]
```

On the extras a stay books, the nights come from the stay:

```json
"capacity": {
  "kind": "night",
  "from": { "via": "stay_id", "column": "arrive" },
  "to": { "via": "stay_id", "column": "depart" },
  "countWhere": { "column": "status", "values": ["booked", "in_house"], "via": "stay_id" },
  "pool": { "via": "extra_id", "size": { "column": "per_night" } },
  "arrived": { "states": ["in_house"], "via": "stay_id" }
}
```

| Field | Rule |
|---|---|
| `from`, `to` | The arrival and the departure: `date` columns of the row, or `{ "via", "column" }` of the row it belongs to. |
| `pool.count` | The pool is the number of rows of `table` whose `column` points at the same row as `via`: the rooms of a type. |
| `pool.size` | Instead of `count`: `1` (one stay a night on each row pointed at, such as a room) or `{ "column" }` of that row (spaces of an extra). |
| `outOfService` | Dated closures of single rooms, `from` to `to` inclusive, an empty `to` open-ended. Each room closed takes one unit from the pool on the nights its closures cover, however many of them overlap. |
| `fits` | A column of the pool's row a guest count must fit, such as how many a room type sleeps. Availability lists only the types that fit the guests asked. |
| `given` | When the row's `via` link is set (a room given), it counts against that room's type, not the one booked. |
| `nights` | `min` and `max` nights, `minByArrival` per weekday of arrival, and `aheadDays`, how far ahead a guest may arrive. |
| `arrived` | The states of a stay whose guest is in the house (its own, or its owner's with `via`). |

A stay must leave after it arrives, and its length must be inside `nights`, or it is refused
`out-of-range` on `to`. A guest may not arrive before the venue's today or further ahead than
`aheadDays`: `out-of-range` on `from`.

**A guest in the house.** A change of a stay whose guest has arrived (another room, another type,
new dates) is judged from the venue's today on. The nights already slept are never judged again: a
room closed last night takes nothing from a guest moved today. A room closed tonight or later
still refuses the move. The extras whose nights come from that stay are judged the same way.

`fits` does not refuse a write. To refuse a stay for more guests than the room sleeps, give the
create entry an `agrees` check (see [An app's public access](https://docs.adminium.dev/guides/apps/public-access/)).
