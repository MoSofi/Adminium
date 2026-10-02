<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § Booking rules and capacity; do not edit -->

# Booking rules and limits: Booking rules and capacity

A table carries one or the other, never both.

| | [Capacity](https://docs.adminium.dev/reference/manifest/#capacity) | Booking rule |
|---|---|---|
| Suits | A restaurant: tables and covers | A clinic or a salon: one person's time |
| Counts | The party sizes that start at each slot, up to a limit per slot | Overlaps per person, by each visit's own length |
| Hours | Every slot of the day | Opening hours or a person's own, breaks, closures |
| Availability asks for | A day and a party size | A kind, a person or `any`, and a day or a strip of days |
| Picks a person | No | Yes, for "anyone" |
