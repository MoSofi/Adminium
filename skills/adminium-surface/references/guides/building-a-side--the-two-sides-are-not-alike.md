<!-- produced from apps/docs/src/content/docs/guides/apps/building-a-side.md § The two sides are not alike; do not edit -->

# Building an app's screens: The two sides are not alike

| | Staff side | Customer side |
|---|---|---|
| Who uses it | Someone signed in to Adminium | Anyone |
| How it reaches data | The data API, with that person's own session | The [public API](https://docs.adminium.dev/guides/public-api/endpoints-and-keys/), with a browser key Adminium serves |
| What it may reach | What the person's roles allow | Only what the manifest's `publicAccess` grants |
| Key in the code | None | None: it is served, never written into the bundle |

Both import their plumbing from `@adminiumjs/adminium/side`. The build supplies that module from
the Adminium doing the building.
