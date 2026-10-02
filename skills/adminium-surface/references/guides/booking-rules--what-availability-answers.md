<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § What availability answers; do not edit -->

# Booking rules and limits: What availability answers

A booking page asks for free times with the table's availability endpoint (see
[An app's public access](https://docs.adminium.dev/guides/apps/public-access/)). It asks for one kind and one person, or
`any`, and then either one day or a strip of days:

```bash
# Every time of one day
curl 'https://admin.example.com/api/v1/public/availability/appointments_availability?kind=3&date=2026-10-06' \
  -H "Authorization: Bearer $ADMINIUM_KEY"
# A strip of up to 31 days
curl 'https://admin.example.com/api/v1/public/availability/appointments_availability?kind=3&from=2026-10-05&days=7' \
  -H "Authorization: Bearer $ADMINIUM_KEY"
```

```json
{ "data": [{ "time": "08:30", "state": "full" }, { "time": "08:45", "state": "free" }] }
{ "data": [{ "date": "2026-10-05", "open": 29, "state": "open" },
           { "date": "2026-10-10", "open": 0, "state": "closed" }] }
```

- **A day** lists each time at least one person in question works, on their grid, off their
  break and not away. A time is **free** when one of them could be booked for it, and **full**
  otherwise. A time in the past or inside the notice reads full.
- **A strip** gives each day's number of free times and a state: **open** when any time is free;
  **full** when people work that day and nothing is free; **closed** when nobody in question
  works, the day is shut, past or beyond the window.

The answer is worked out by the same checks as a booking, so a time shown free is a time the
booking takes, unless someone takes it first. A guest's answer never names a person or counts
anything, and it covers only people bookable online.

**Moving one's own visit.** Add `exclude=<id>` with the visit being moved, so its own time does
not block the new one. It works only for a visit the guest's session reaches. For any other id
the answer is the same as without it.

Leaving out the kind, asking with a party size, or mixing a day with a strip is refused
`400 PUBLIC_QUERY_REFUSED`.

### The staff answer

The app's staff screens ask `GET /api/v1/data/<connection>/<table>/booking-slots` with the same
`kind`, `resource`, `date` or `from` and `days`, and `exclude`. It needs read access to the
table. Staff are not held to the notice, see people who are not bookable online, may exclude any
visit, and, when they ask about `any`, learn which person each free time would book.
