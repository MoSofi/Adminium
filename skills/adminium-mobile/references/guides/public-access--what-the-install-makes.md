<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § What the install makes; do not edit -->

# An app's public access: What the install makes

For each line, one public endpoint on the app's real table:

- **A records endpoint**, named after the table, with the methods the app asked for. It exposes
  the columns the app lists, or else every column it declares for that table, and the writable
  columns and fixed filters the app names. It returns 50 rows by default and at most 200.
- **An availability endpoint**, named *table*`_availability`, when the app takes bookings against
  a limit per time slot or a [booking rule](https://docs.adminium.dev/guides/apps/booking-rules/). It answers only whether
  each time is **free** or **full**, and never returns a row, a name or a count. See
  [Free or full](https://docs.adminium.dev/guides/public-api/endpoints-and-keys/#free-or-full).
- **A claim endpoint**, named *table*`_claimed`, when guests look up their own row, and one for
  each table of [a person's own rows](https://docs.adminium.dev/guides/apps/public-access/#a-persons-own-rows): *table*`_claimed`, or
  *table*`_verified` when it needs a [confirmed code](https://docs.adminium.dev/guides/apps/public-access/#the-emailed-code).

Then one browser key per key the app declares, granting exactly its endpoints and methods:

- **The guests' key**, named after the app with "· guests" at the end, for the customer screens.
  The customer screens fetch it from the server each time they load, so it never has to be built
  into them.
- **A second key**, when the app declares one, named after the app and the key, such as
  "· kiosk". It serves a staff member's screen; see [A kiosk](https://docs.adminium.dev/guides/apps/public-access/#a-kiosk).

Neither is narrowed to any origin.
