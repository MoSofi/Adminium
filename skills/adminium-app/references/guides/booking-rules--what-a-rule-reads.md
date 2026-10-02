<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § What a rule reads; do not edit -->

# Booking rules and limits: What a rule reads

| Part | What it is |
|---|---|
| The visit | Its start, its length in minutes, the person it takes and its kind (a visit type). The length is usually copied from the kind. |
| Who does what | A list of which people offer which kinds. A person with no line for a kind is never booked for it. |
| The people's order | An order for "anyone" to pick in, and two switches per person: **active**, and **bookable online**. |
| Opening hours | One row per weekday: opens, closes, and an optional break. A weekday can be switched off. |
| A person's own hours | Optional. A person with rows here follows them every day, and a weekday with no row is their day off. A person with none follows the opening hours. |
| Closures | Dated closures, from one day to another, for everyone or for one person. A closure can be switched off. |
| Settings | The grid, the booking window, the notice and the late-cancellation hours. Each can be a number in the app's settings row, so you change it there without an update. |

Only visits whose status is one of the counted values take time. A cancelled visit takes none.
