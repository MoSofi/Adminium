<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md § Three cases; do not edit -->

# Timed moves on the venue's clock: Three cases

### An order still placed at closing

The example [above](https://docs.adminium.dev/guides/apps/timed-moves/#a-timed-move). At most one timed move leaves each state, so an order that
can also be stuck in `confirmed` gets a second rule, `from: "confirmed"`, with the same `to`, `at`
and `set`.

### A ticket offer that lapses

A buyer offers a ticket to a friend. The offer runs for `offer_hours` from the moment it is made.
If the friend has not accepted by then, the ticket goes back to `valid` for the buyer:

```json
"columns": [
  { "ref": "pending_email", "type": "text", "maxLength": 254, "nullable": true },
  { "ref": "pending_name", "type": "text", "maxLength": 120, "nullable": true },
  {
    "ref": "link_token", "type": "text", "maxLength": 16, "nullable": true,
    "rules": { "code": { "length": 16, "renew": { "on": { "column": "pending_email", "changed": true } } } }
  },
  {
    "ref": "offer_until", "type": "timestamptz", "nullable": true,
    "rules": {
      "stamp": {
        "set": { "addMinutes": { "hours": { "table": "settings", "column": "offer_hours" } } },
        "on": { "column": "status", "values": ["offered"] }
      }
    }
  }
],
"states": {
  "column": "status",
  "initial": "valid",
  "moves": { "valid": ["offered", "checked_in"], "offered": ["valid", "checked_in"] },
  "timed": [
    { "from": "offered", "to": "valid", "at": { "column": "offer_until" }, "set": { "pending_email": null, "pending_name": null } }
  ]
}
```

The lapse empties the friend's name and address, and the link code renews with it.

### A guest who never arrives

A stay arrives on a date. A guest still `booked` at 10:00 the day after is a no-show:

```json
"timed": [
  {
    "from": "booked",
    "to": "no_show",
    "at": { "column": "arrive", "time": { "table": "settings", "column": "no_show_at" }, "plus": { "days": 1 } }
  }
]
```

`arrive` is a date, so the moment names a time on it: `no_show_at` from the settings row. One
calendar day later keeps the wall time: a guest due on Saturday 24 October 2026 in London becomes a
no-show at 10:00 on Sunday, although the clocks went back that night.
