<!-- produced from apps/docs/src/content/docs/guides/apps/working-days.md § How the count goes; do not edit -->

# Ready-by dates in working days: How the count goes

1. **The day it is received.** The order is received on the shop's day of `from`, when that is a
   working day and the time is before the cut-off. Otherwise it is received on the next working day.
   A `from` that is a date with no time ignores the cut-off.
2. **The days after it.** The date is the `days`-th working day after the received day. `0` days is
   the received day itself.
3. **A working day** is a day of the working week that no active closure covers.

With a Monday-to-Friday week and a 14:00 cut-off, 3 working days:

| Order in | Received | Ready by |
|---|---|---|
| Friday 13:59 | Friday | Wednesday |
| Friday 14:01 | Monday | Thursday |
| Saturday 10:00 | Monday | Thursday |
| Friday 13:59, the Monday a bank holiday | Friday | Thursday |

The day is the one on the shop's wall: `from` is read on the connection's time zone, so an order in
at 23:30 the night the clocks change lands on the day the shop would say.
