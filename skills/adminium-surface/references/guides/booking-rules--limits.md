<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § Limits; do not edit -->

# Booking rules and limits: Limits

Most apps that sell to guests do not book a person. They sell a share of a **pool**: a kitchen's
orders per pickup slot, the seats of a ticket type, today's portions of a dish, the rooms of a
type on each night. A table says so with `capacity`, and Adminium keeps its rows inside the pool
on every write, whoever makes it. The fields are listed in the
[manifest reference](https://docs.adminium.dev/reference/manifest/#capacity).

A limit is one of three kinds:

| Kind | A row takes | For example |
|---|---|---|
| `slot` | Its amount from the pool of the time it starts at | Orders per 15-minute pickup slot |
| `parent` | Its amount from a limit held on the row it points at | Tickets of a type, portions of a dish today, uses of a code |
| `night` | One unit on every night of its stay, from a pool counted in another table | Rooms of a type, one stay per room, parking spaces |

A rule with no `kind` is a slot rule.
