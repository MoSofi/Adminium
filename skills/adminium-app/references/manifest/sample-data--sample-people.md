<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Sample data — Sample people; do not edit -->

# Manifest spec: Sample data — Sample people

### Sample people

A sample business has people: a rep per pipeline, a crew per van. `people` and `teams` say who
they are, and a sample row names one with [`{ "@person": "<key>" }`](https://docs.adminium.dev/reference/manifest/#sample-data):

```json
"sampleData": {
  "file": "seeds/crm.sample.json",
  "people": [
    { "key": "dana", "name": "Dana Whitlock", "email": "dana@meridian.example", "role": "rep" },
    { "key": "ivy", "name": "Ivy Sandoval", "role": "sales-manager" }
  ],
  "teams": [{ "name": "Sales", "lead": "ivy", "members": ["dana"] }]
}
```

| Field | Rule |
|---|---|
| `people` | 1–200 of `{ "key", "name", "email"?, "role"? }`. `key` is lower-case letters, digits, `_` and `-`, at most 40, and listed once. `role` is the key of one of this app's own [`roles`](https://docs.adminium.dev/reference/manifest/#roles). `email` is shown beside the name and never mailed; where it is left out, or somebody already has it, Adminium gives the person an address of its own (`dana.crm@sample.invalid`). |
| `teams` | 1–50 of `{ "name", "lead"?, "members" }`: the people of one team, by key. `lead` leads it, so a role limited to its team's rows reaches the members' rows. A team name the operator already uses is left to them: the sample's team is made beside it as "Sales (sample)". |

"Add sample data" makes each person a staff member marked as a **sample person**: no password and
no way to get one, nothing is ever mailed to them, and nothing about them is changed by hand. They
are listed on the Team page under their own status and are in no other count. "Remove sample
data" takes them and their teams away, but for a person a row that stays still names (a deal the
operator made and gave to a sample rep): that person stays until the row names somebody else, and
the next "Add sample data" takes them back instead of making a second one. An add-on's manifest
takes neither field. Needs Adminium 0.3.27.

The file uses the `adminium.sample/1` format:

```json
{
  "format": "adminium.sample/1",
  "app": "visits",
  "tables": [
    { "ref": "clients", "rows": [{ "@label": "ada", "name": "Ada Byrne" }] },
    { "ref": "visits", "rows": [
      { "client_id": { "@ref": "ada" }, "starts_at": { "@day": 1, "@time": "09:30" },
        "note": { "@t": { "en-US": "First visit", "de-DE": "Erster Besuch" } } }
    ] }
  ]
}
```

| Field | Rule |
|---|---|
| `format` | Always `"adminium.sample/1"`. |
| `app` | The app's `key`. |
| `tables` | At least one `{ "ref", "rows" }`, each with 1–5000 rows, written in the order listed (parents first) and removed in reverse. Every `ref` and column must be declared in `requiredSchema`. |
| `assets` | Optional files for `@asset`: an object from a label to `{ "file": "seeds/…", "sha256": "<64 hex>" }`. |
| `weekAnchor` | Optional: the weekday (`mon` … `sun`) the sample was written for, which `@week` days count from. |

A row may carry an `@label` (letters, digits and `: . _ -`, unique in the file) so a later row can
point at it.

A column numbered [without gaps](https://docs.adminium.dev/reference/manifest/#numbers-without-gaps) is spelled `null` in every sample row
(`"number_seq": null`); its `format` text is whatever the row gives (its own spelling, such as
`INV-S2041`), or empty. A sample row then
stays off the real series: the first real invoice is still number one. Adding the sample is
refused when a row leaves a gapless column out or gives it a number.

A value is plain JSON, or one of these directives:

| Directive | Value |
|---|---|
| `{ "@ref": "<label>" }` | The key of an earlier row with that label. In an add-on's sample it may also be the label of one of the add-on's `seeds` rows (a unit the install wrote). |
| `{ "@person": "<key>" }` | One of the manifest's [sample people](https://docs.adminium.dev/reference/manifest/#sample-people): the staff member made for that key. In a staff column (`rules.staff`) or another text column that holds a staff member's id, and anywhere inside a json value (a saved filter that names a rep). Only in the app's own sample file, not in its rows for an add-on. |
| `{ "@ago": "PT19M" }` | An ISO 8601 duration before now. |
| `{ "@in": "PT20M", "@grid": 15 }` | An ISO 8601 duration after now. With `@grid`, rounded up to the next step of that many minutes on the venue's own clock, counted from its midnight (never past the next midnight): the first pickup slot at least 20 minutes away. |
| `{ "@in": "PT20M", "@slot": "orders" }` | The first open time of that table's [slot limit](https://docs.adminium.dev/reference/manifest/#slot-limits) at least that far ahead: its hours, closures and pauses, on its grid, with room left after the sample's own rows placed so far; on the next open day when today has none, looking two weeks ahead, else the plain `@in` time. Not with `@grid`. |
| `{ "@day": -1, "@time": "09:30" }` | A wall time in the venue's time zone, a number of days from today (−366 to 366). |
| `{ "@day": 3 }` | A date: that many days from today, as the venue's calendar has it. For a `date` column. |
| `"@workdays": true` | Added to either `@day` form: the days count Monday to Friday only, and day 0 on a weekend is the Monday after. So the sample's busy day is never a Saturday. |
| `"@week": true` | Added to either `@day` form instead: the days count from the bundle's `weekAnchor` in the week nearest today (three days either way), so every date keeps the weekday it was written for: a weekend stay stays on a weekend, whatever day the sample is added on. Needs `weekAnchor`. |
| `{"@month": -2, "@dom": 14}` | A date in the venue's time zone: that day of the month, so many months back (`0` is this month). Add `"@time": "10:00"` for a time on that day. A day past the month's end is its last day, and a day that has not come yet is today (a time not yet come, now). Use it for history counted in calendar months: "this month" and "in May" read the same whether the sample is added on the 3rd or the 28th. |
| `{ "@t": { "en-US": "…" } }` | Text in the language of the person adding the sample. Keys are `xx` or `xx-XX`. |
| `{ "@asset": "<label>" }` | A file from `assets`, added to the Files library. |

Beside its `@label`, a row may carry the row directive `@byClock`, so that a sample day's
statuses match the time it is added at:

```json
{ "@label": "visit-2", "starts_at": { "@day": 0, "@time": "10:00", "@workdays": true },
  "status": "booked",
  "@byClock": { "at": "starts_at",
                "before": { "status": "seen" },
                "around": { "status": "checked_in" } } }
```

| Field | Rule |
|---|---|
| `at` | The row's time: the name of a column the row sets, or a `@day` with a `@time`. |
| `before` | Columns merged into the row when its time is more than half an hour before the moment the sample is added. |
| `around` | Columns merged when its time is within half an hour of it. |
| `after` | Columns merged when its time is later. |

Each set holds columns of the table, and may use directives. A set with `"@skip": true` leaves the
row out altogether: a payment for a visit that has not happened yet.

A row that lasts from one time to another (a stay) may carry `@byStay` instead, placing it by where
the adding moment falls against its two times:

```json
{ "@label": "stay-4", "arrive": { "@day": -1, "@week": true }, "depart": { "@day": 2, "@week": true },
  "status": "booked",
  "@byStay": { "from": "arrive", "to": "depart", "times": { "from": "15:00", "to": "11:00" },
               "during": { "status": "in_house" }, "after": { "status": "departed" } } }
```
