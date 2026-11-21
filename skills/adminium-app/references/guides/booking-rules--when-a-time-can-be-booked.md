<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § When a time can be booked; do not edit -->

# Booking rules and limits: When a time can be booked

A booking is taken only when all of these hold:

- **Offered.** The person offers the kind and is active. A guest booking online can have only a
  person marked bookable online.
- **In hours.** The visit starts at or after opening and ends by closing. It does not touch the
  break. Hours that would cross midnight count as a closed day. A person with hours of their own
  follows them, unless the rule says `"within": "practice"`: then the practice's hours cap theirs,
  so shortening the opening hours shortens what can be booked.
- **On the grid.** Starts are every *grid* minutes, counted from opening. With opening at 08:30
  and a grid of 15, a visit can start at 08:30 or 08:45, never 08:40.
- **Not closed.** No closure covers that day for everyone or for that person.
- **Not in the past.** See [walk-ins](https://docs.adminium.dev/guides/apps/booking-rules/#walk-ins) for the one exception.
- **Inside the window.** The booking window counts **working days** from today, both days
  included. A working day has opening hours and no closure for everyone. With a window of 20,
  the twentieth working day from today is the last one bookable. With `"windowFor": "guests"`
  the window holds guests only, and staff can book further ahead.
- **Far enough ahead,** for a guest. The notice is in minutes. Staff are never held to it.
- **Free.** No other counted visit of that person overlaps it. Each visit is measured by its own
  length and its `buffer`, and the end is open: a 30-minute visit at 09:00 leaves 09:30 free, and
  with a 15-minute buffer leaves 09:45 free. A buffer may run past closing or into a break.
- **Not away.** The time and its buffer touch none of the person's `busy` times: their time off,
  or a connected calendar. These bind staff and guests alike.

A 45-minute kind is judged as 45 minutes. If it would run into the break or past closing, that
start is not offered for it, even when a 15-minute kind fits there.

### "Anyone"

A visit created with no person means anyone. Adminium looks at each person who offers the kind and
whom the time suits, skipping anyone not active and, for a guest, anyone not bookable online. By
default it books the first in the people's order. With `anyone: { "pick": "even" }` it shares the
work: the person with the fewest counted visits that day, then the one whose last booking was made
longest ago, then the order. The pick is written with the visit, so the page learns who it is only
from the saved booking. `anyone.flag` names a column Adminium sets to say the person was picked.

To move an "anyone" visit, send the new start with the person empty. The visit keeps its person
when they are free at the new time, and otherwise goes to whoever the pick gives.

When nobody fits, the refusal is the one nearest to a yes: taken, then closed, then out of hours,
then out of range, then not offered.

### Walk-ins

A visit may not start in the past, with one exception. Staff may create a **walk-in** in the grid
slot that holds the current time: at 09:35 on a 15-minute grid, that is the 09:30 slot. It counts
as a walk-in when it is created with a counted status other than the first, for example
`checked_in` rather than `booked`.

### Moving and changing a visit

The rule runs on a create, and on a change that **moves** the visit: its start, length, person or
kind. A cancelled visit booked again is checked for overlap only, busy times included.

A busy time that arrives after a booking never moves or refuses it. While the visit keeps its start
and person, it can be edited freely. If the edit makes it longer, only the added time is held to
the person's busy times.

A change between two counted statuses runs nothing. Checking a person in at 09:05 for their 09:00
visit, or on a day a closure was added since, is never refused.
