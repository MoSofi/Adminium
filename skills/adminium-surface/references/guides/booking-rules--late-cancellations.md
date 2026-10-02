<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § Late cancellations; do not edit -->

# Booking rules and limits: Late cancellations

A rule can declare a cancellation window, in hours before the visit's start. What happens inside
it depends on the rule's mode:

| Inside the window | Mode `flag` | Mode `refuse` |
|---|---|---|
| A guest cancels | Goes through, and the visit is flagged late | Refused with `PUBLIC_TOO_LATE` |
| Staff cancel | Goes through, and the visit is flagged late | Goes through, not flagged |
| A guest moves the visit | Refused with `PUBLIC_TOO_LATE` | Refused with `PUBLIC_TOO_LATE` |
| Staff move the visit | Goes through | Goes through |

A guest can always cancel or move a visit outside the window. Inside it, the page tells them to
ring instead. The late flag is set by Adminium and never by a browser. An undo in the dashboard
puts it back as it was. An import, sample data and an undo never set it.
