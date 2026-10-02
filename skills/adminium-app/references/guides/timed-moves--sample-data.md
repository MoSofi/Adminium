<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md § Sample data; do not edit -->

# Timed moves on the venue's clock: Sample data

Sample rows are moved like any other. A sample order whose pickup time passes is cancelled at
closing, as a real one is. The move sends no email, because the outbox leaves sample rows alone.
A sample row a timed move changed is still sample data: **Remove sample data** takes it, and every
row its effect moved too.

Write sample times relative to the moment the sample is added, so a fresh sample is not swept at the
next minute. `{"@in": "PT20M", "@slot": "orders"}` puts an order on the next open pickup slot, and
`@byStay` gives a stay the status that matches the clock. See
[Sample data](https://docs.adminium.dev/guides/apps/sample-data/) and the [format](https://docs.adminium.dev/reference/manifest/#sample-data).
