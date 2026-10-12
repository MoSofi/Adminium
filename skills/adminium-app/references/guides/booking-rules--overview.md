<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md; do not edit -->

# Booking rules and limits

Some apps book **people** rather than seats: a clinician, a stylist, a tutor. A table of visits
then carries a **booking rule**. Each visit takes one person for its own length, and two visits of
one person never overlap. The time must also fall inside that person's hours, off their break, on
the booking grid and outside any closure.

The app declares the rule, and the install stores it on the app's real tables. Every write to the
table goes through it: the app's own screens, your pages in the dashboard, the public API,
automations. The fields are listed in the [manifest reference](https://docs.adminium.dev/reference/manifest/#booking).

Not everything that is taken for a time is a person booked for a visit: a showroom bay for an
hour, a demo van for a day, a crew on the weekdays it works. For those a table says
[`occupies`](https://docs.adminium.dev/reference/manifest/#a-resource-and-a-time) instead: a resource, a time and, if the
app keeps them, the weekdays the resource works. No two rows of one resource overlap, and nothing
else on this page applies to it but the lock and the refusal codes.
