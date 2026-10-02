<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md; do not edit -->

# Booking rules and limits

Some apps book **people** rather than seats: a clinician, a stylist, a tutor. A table of visits
then carries a **booking rule**. Each visit takes one person for its own length, and two visits of
one person never overlap. The time must also fall inside that person's hours, off their break, on
the booking grid and outside any closure.

The app declares the rule, and the install stores it on the app's real tables. Every write to the
table goes through it: the app's own screens, your pages in the dashboard, the public API,
automations. The fields are listed in the [manifest reference](https://docs.adminium.dev/reference/manifest/#booking).
