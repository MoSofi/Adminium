<!-- produced from apps/docs/src/content/docs/guides/apps/maps.md § A place: by town or exact; do not edit -->

# Maps, places and routes: A place: by town or exact

A column that holds a position is a `json` column with the [`place`](https://docs.adminium.dev/reference/manifest/#a-place-and-an-area)
rule:

```json
{ "ref": "spot", "type": "json", "nullable": true, "rules": { "place": true } }
```

What it keeps says how the position is known:

```json
{ "lat": 30.06263, "lng": 31.24967, "by": "town", "placeId": 360630, "name": "Cairo", "country": "EG" }
```

```json
{ "lat": 30.0444, "lng": 31.2357, "by": "exact" }
```

**`by: "town"` means "somewhere in this town".** The position is the middle of the town, taken
from Adminium's list. It is good for a map of customers by town and for a rough distance. It is
not the customer's door, and Adminium never shows it as if it were: a pin by town is drawn
differently from an exact one, and a distance from it is marked as an estimate. A position by
town is always filled in by the server from the list, so nobody can store a made-up point and
have it read as a town's.

**`by: "exact"` is a point a person gave**: dropped on the map, typed as `lat,lng`, or pasted.

A save may give any of these for a place column, and so may a line of an import:

| Given | Kept as |
|---|---|
| `{ "placeId": 360630 }` | The town, by town |
| `{ "lat": 30.0444, "lng": 31.2357 }` | Exact |
| `30.0444,31.2357` | Exact |
| `geo:30.0444,31.2357` | Exact |
| A map link with the position in it (Google Maps, OpenStreetMap, Apple Maps) | Exact |

A pasted link is only ever read as text. A short link (`maps.app.goo.gl/…`) says nothing until
it is followed, and Adminium does not follow links, so it is refused with a message that says
so: open the link, copy the long address or the coordinates, and paste those.

### The list of towns

`GET /api/v1/geo/places?q=` answers towns whose name starts with what was typed, in the reader's
language where the list has the name, the largest first. It holds about 170,000 places: every
one with 1,000 people or more. Typing without accents works (`sao joao`), and so does Arabic
with or without its hamza and ta marbuta. The list is made from [GeoNames](https://www.geonames.org/)
data, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), and ships inside
Adminium: looking a town up asks no other server, with maps on or off.

`POST /api/v1/geo/places/match` takes up to 200 addresses' towns at once (`town`, and `region`
and `country` where known) and answers the place for each, or `null`. It never guesses: a town
the list does not have, or one named in a country it is not in, is `null`.
