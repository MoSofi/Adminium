<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § Connected calendars; do not edit -->

# Booking rules and limits: Connected calendars

With [`booking.sync`](https://docs.adminium.dev/reference/manifest/#booking), each person's bookings go to a calendar of their
own at Google or Microsoft, and the times they are busy there block new bookings.

- **Going out.** A booking reaches its person's calendar within a minute. A move follows it, a
  cancellation takes it out, and a booking handed to someone else leaves the first person's calendar.
  An event changed or deleted in the calendar is put back. A calendar deleted outright is made again
  once, and a second deletion within a week stops the sync for that person until they turn it back on.
- **Coming in.** Each read covers today to two days past the last bookable day, whole, and swaps in
  one step. A read that fails changes nothing. Push tells Adminium at once where the server has a
  public https address. Without it, a busy time blocks within about 12 minutes, and a time booked in
  those minutes shows as a clash.
- **What counts.** Times marked busy or out of office count, and tentative and free ones do not. An
  all-day event counts when the person ticked it, on a provider that can tell one apart.
- **A first read.** A person's slots stay closed until their calendar has been read, for two minutes
  at most.
- **Reconnecting.** While a connection needs reconnecting, its last known busy times keep blocking
  for seven days, shown with their date. Then they are dropped and the desk is told.
- **Clashes.** A busy time that lands on a booking already there never moves it. The desk sees a
  clash and may move the booking or keep it. Keeping it holds until the overlap itself changes.
- **Names.** At most a first name and initial go out. The morning after the visit the title becomes
  the service alone, and a person who is forgotten or erased leaves every event at once.

The desk's calls are under `/api/v1/calendar-sync`. Reading a person's calendar needs read on their
row, and changing it needs update on it. Reading a clash needs read on the booking, and keeping it
needs update.
