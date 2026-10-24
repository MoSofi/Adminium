<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Maps; do not edit -->

# Manifest spec: Maps

`"maps": true` at the top of an app's manifest says the app shows maps. A map's pictures are
fetched by each person's browser from a map server, so whether maps are shown is one switch for
the whole install. The install check of the **first** app that says this asks, with the tick on;
once somebody has answered, no later install asks again. Needs Adminium 0.3.28.

Until somebody answers, maps are shown: the core's own map widget works on a fresh install. The
answer is changed in **Settings → Maps**, and the operator can switch maps off for the install
whatever it says ([`ADMINIUM_MAP_SERVER=off`](https://docs.adminium.dev/self-hosting/env-vars/#adminium_map_server)).
[Maps, places and routes](https://docs.adminium.dev/guides/apps/maps/) says what a map asks of which server.

### A place and an area

Two [column rules](https://docs.adminium.dev/reference/manifest/#column-rules), each on a `json` column. A column takes one of them, not
both. They need Adminium 0.3.28.

```json
{ "ref": "spot", "type": "json", "nullable": true, "rules": { "place": true } },
{ "ref": "zone", "type": "json", "nullable": true, "rules": { "area": true } }
```

**A place** is kept as one object, or `null`:

| Field | |
|---|---|
| `lat`, `lng` | The position, in degrees. |
| `by` | `"town"` or `"exact"`: how the position is known. |
| `placeId` | The town's id in Adminium's list of places. Always there for `by: "town"`; on an exact point it names the town the point is in. |
| `name` | The town's name as the list has it; or, on an exact point with no `placeId`, a label the writer gave (up to 200 characters). |
| `country` | Two letters, upper case. |

**What a pin by town means.** `by: "town"` is the middle of a town, not an address: "somewhere
in Cairo". It is what an app has when all it was given is a town's name. Adminium fills the
position in itself from its list (`placeId`), whatever position the writer sent beside it, so a
point nobody measured can never be stored as a town's or the other way round. A map draws such
a pin differently from an exact one, a distance from it is an estimate, and the way between two
stops known only as the same town is answered as unknown, never as zero, with why
(`why: "same-town"`: both stops are pinned to the town; place them to measure). If your app needs the
door, ask for an exact point.

Every way of writing the row takes the same things for a place (a staff save, an import, a
rule's step, a public entry that may write the column), and stores them alike:

| Given | Kept as |
|---|---|
| `{ "placeId": 360630 }` | `{ "lat": 30.06263, "lng": 31.24967, "by": "town", "placeId": 360630, "name": "Cairo", "country": "EG" }` |
| `{ "lat": 30.0444, "lng": 31.2357 }` | `{ "lat": 30.0444, "lng": 31.2357, "by": "exact" }` |
| `"30.0444,31.2357"` or `"geo:30.0444,31.2357"` | The same exact point. |
| A map link with the position written in it | The same exact point. Read from the link's text: Google Maps (`@lat,lng`, `?q=`, `ll=`, a pin's `!3d…!4d…`), OpenStreetMap (`#map=zoom/lat/lng`, `mlat`/`mlon`), Apple Maps (`ll=`). |

Adminium never opens a pasted link. A short link (`maps.app.goo.gl/…`), which says nothing
until it is followed, is refused.

A value that is not one of these is refused with `422`, the column named in `details.fields`
with one of:

| Code | |
|---|---|
| `place-unreadable` | Not a position: free text, a link with no position in it, `by: "town"` without a `placeId`. |
| `place-short-link` | A link that would have to be followed to say where it points. |
| `place-out-of-range` | A latitude beyond ±90 or a longitude beyond ±180. |
| `place-unknown` | A `placeId` the list of places does not have. |

**An area** is kept as a GeoJSON geometry, or `null`: a `Polygon` or a `MultiPolygon`, with
positions east first (`[lng, lat]`). A `Feature` wrapping one is taken and kept as the bare
geometry; a height after a position is dropped. Every ring is closed (its last position is its
first) and has at least four positions; the whole shape has at most 2,000 positions and 64 KB.
Refused with `area-unreadable` (not such a shape, an open ring, a position off the map) or
`area-too-large`.

Both are read back as objects on every database, in a list, on a record and through the
dashboard's own routes. An export to CSV writes a place as `lat,lng`, which an import reads
back as an exact point (JSON Lines keeps the whole object), and an area as its JSON.

A map widget takes its points from a place column: a `geo-points` query that selects a name,
then the place column, then any numbers to show (`"select": ["name", "spot", "visits"]`). Each
point says how it is known (`by`), and a row with no place is left off the map.
