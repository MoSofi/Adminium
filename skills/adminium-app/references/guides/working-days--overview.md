<!-- produced from apps/docs/src/content/docs/guides/apps/working-days.md; do not edit -->

# Ready-by dates in working days

A print shop promises "ready in 3 working days", a workshop "dispatched in 5". Counting that by hand
goes wrong on Fridays, after the afternoon cut-off and around bank holidays. Adminium counts it for
the app: a [stamp](https://docs.adminium.dev/reference/manifest/#stamps) with `addWorkingDays` writes the date when the order
comes in, and counts it again whenever what it reads changes.
