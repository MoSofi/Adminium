<!-- produced from apps/docs/src/content/docs/guides/apps/sample-data.md § Sample times that follow the calendar; do not edit -->

# Sample data: Sample times that follow the calendar

Sample times are written relative to the moment the data is added, on the venue's clock, so a
sample never looks stale. Three forms keep it believable whatever day and hour that is. The
fields are in the [manifest reference](https://docs.adminium.dev/reference/manifest/#sample-data).

- **Days that keep their weekday.** A hotel's sample has a weekend stay. With
  `{"@day": 3, "@week": true}` its days count from the bundle's `weekAnchor` (a weekday such as
  `"tue"`) in the week nearest the adding day, at most three days either way. Added on a Tuesday
  or a Thursday, the stay still arrives on a Friday. A `@week` day needs the bundle to name its
  anchor.
- **A status that matches the clock.** `@byStay` sets some of a row's columns by where the adding
  moment falls against its two times: before the stay, during it, or after it.

  ```json
  {
    "arrive": { "@day": 3, "@week": true },
    "depart": { "@day": 5, "@week": true },
    "@byStay": {
      "from": "arrive",
      "to": "depart",
      "times": { "from": "15:00", "to": "11:00" },
      "before": { "status": "booked" },
      "during": { "status": "in_house" },
      "after": { "status": "departed" }
    }
  }
  ```

  `from` and `to` are columns of the row, or times written in place. A date is read at the
  `times` given (arriving from 15:00, leaving by 11:00), else at its midnight. A set with
  `"@skip": true` leaves the row out. A row takes `@byStay` or `@byClock`, not both.
- **A time the venue is open.** A pickup order 20 minutes from now is no use at 21:10 when the
  kitchen closed at 21:00. `{"@in": "PT20M", "@slot": "orders"}` is the first open time of that
  table's slot limit at least that far ahead: its hours, closures and pauses, on its grid. It counts
  the rows already there and the sample rows placed so far, so a time that is full is passed over.
  When today has no open time left, it is the next day the venue opens. It looks about two weeks
  ahead, and a limit with no open time in reach keeps the plain time. The table must keep a slot
  limit, and `@slot` takes no `@grid` of its own.

Sample rows are real rows to the app's rules. A sample pickup order takes its place in the slot it
lands on, and a sample stay takes its room for its nights, so guests see that much less on the
customer pages. Remove the sample data before you open for real.
