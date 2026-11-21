<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Booking; do not edit -->

# Manifest spec: requiredSchema — Booking

The public API answers a clash with `PUBLIC_SLOT_FULL`; a time outside hours, on a closure,
beyond the window or with nobody offered for the kind with `PUBLIC_WRITE_REFUSED`; and a guest's
late move, or a late cancellation in `refuse` mode, with `PUBLIC_TOO_LATE`. An
[`availability`](https://docs.adminium.dev/reference/manifest/#public-access) entry on a booking table lists the free times of a day, or a
strip of days, for a kind.
