<!-- produced from apps/docs/src/content/docs/guides/public-api/endpoints-and-keys.md; do not edit -->

# Endpoints and keys

The public API lets code that is not the dashboard read and write your database: a
storefront page, a booking widget, a nightly sync on another server. It answers at
`/api/v1/public/records`, and nothing is reachable through it until you create an
**endpoint** and a **key** that grants it.
