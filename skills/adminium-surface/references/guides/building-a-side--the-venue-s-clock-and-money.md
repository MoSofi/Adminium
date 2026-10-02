<!-- produced from apps/docs/src/content/docs/guides/apps/building-a-side.md § The venue's clock and money; do not edit -->

# Building an app's screens: The venue's clock and money

Times belong to the venue, not to whoever is reading. A staff session carries `timezone` (an IANA
zone such as `Europe/Copenhagen`) and `currency`. When the database has no time zone set,
`timezone` is `UTC` and `timezoneIsFallback` is `true`: show a line saying times are in UTC.

Never use the browser's own zone
(`Intl.DateTimeFormat().resolvedOptions().timeZone`): it is the reader's, and it is wrong by a
whole number of hours without anyone noticing. `@adminiumjs/public-client` exports `toTenantDay`,
`toTenantMinutes`, `fromTenantLocal` and `formatTenantMoney` for both sides.
