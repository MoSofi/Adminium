---
title: Maps, places and routes
description: What a map needs and what it tells whom. Places by town or exact, areas, routes as estimates, turning maps off, and hosting the map and routing servers yourself.
---

Adminium draws maps, keeps a position or an area in a column, finds a town by its name and works
out the way between stops. All of it works with no account and no key. This page says what each
part asks of which server, so you can decide what to leave on.

## What works with nothing set up

| | Asks another server? |
|---|---|
| Finding a town by name (`GET /api/v1/geo/places`) | **No.** The list of towns ships with Adminium. |
| Keeping a place or an area in a column | **No.** A pasted map link is read as text; it is never opened. |
| The way between stops, as straight lines | **No.** |
| Drawing a map | **Yes: each viewer's browser** fetches the map's pictures from the map server. |
| The way between stops along roads | **Yes: your Adminium server** asks the routing server. Off until you switch it on. |
| "Open in my maps app", "Open on OpenStreetMap" | **Only when a person presses the link.** It is a link, never a request Adminium makes. |

## The map server

A map is drawn in the browser from pictures (tiles) of the part of the world on screen. They
come from the **map server**, by default `https://tiles.openfreemap.org`, a free service that
needs no key.

What the map server learns: the **viewer's address** (their IP) and **which part of the world
they looked at**, at which zoom. It is never sent a row, a name, an address from your data, or
where your pins are: the pins are drawn by the browser on top of the pictures.

The map server's address is set by whoever runs the server, with
[`ADMINIUM_MAP_SERVER`](/self-hosting/env-vars/#adminium_map_server), and is shown in
**Settings → Maps**. It cannot be typed into the dashboard. That is deliberate: the address is
written into the page's security policy, which is what lets a browser talk to it at all, and a
box anyone with the settings permission could type an address into would be a way to let every
staff browser talk to any server.

While maps are on, that policy carries the map server's address on every page, the sign-in page
too, so the address is not a secret from somebody who is not signed in. While maps are off,
nothing the server sends names it.

## The link out to a maps app

A map's list offers a way out to a map the person already uses. Adminium asks nothing of
anybody for it: it is a link, and nothing leaves until the person presses it.

- **On a phone or a tablet**, each placed row has "Open in my maps app". The device hands the
  position (and the row's name, as the search words) to its own maps app: a `geo:` link, or
  Apple's maps address on an Apple device, which does not open `geo:`.
- **On a desk**, the picked place has "Open on OpenStreetMap (new tab)". Pressing it opens
  `https://www.openstreetmap.org/?mlat=…&mlon=…` in a new tab. OpenStreetMap then learns the
  **viewer's address** (their IP) and **that one position**, to about a metre. It is not sent
  the row's name, anything else from your data, or the page the link was on (the tab is opened
  with no referrer). This link is not shown while maps are off.

A map on an app's own screen can leave the desk's link out
([`mapsSiteLink`](/guides/apps/kit-parts/#open-in-my-maps-app)).

## Turning maps off

Three things switch maps off. Any one is enough, and while maps are off the page's security
policy names **no outside server at all**:

- **Settings → Maps → Show maps.** For the whole install. An app that shows maps asks this when
  it is installed, with the tick on.
- **`ADMINIUM_MAP_SERVER=off`.** The operator's no; the switch in Settings then does nothing.
- **The desktop app.** It shows no outside map.

With maps off, everything else on this page still works: places are found, positions are kept,
and a list shows a position as text.

## A place: by town or exact

A column that holds a position is a `json` column with the [`place`](/reference/manifest/#a-place-and-an-area)
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

## An area

A column that holds an area is a `json` column with the `area` rule. It keeps a GeoJSON
`Polygon` or `MultiPolygon`: a delivery zone, a sales territory. Rings are closed, there are at
most 2,000 points, and positions are written east first (`[lng, lat]`), as GeoJSON does.

```json
{ "ref": "zone", "type": "json", "nullable": true, "rules": { "area": true } }
```

## Routes are estimates

`POST /api/v1/geo/route` takes 2 to 50 stops and answers the legs between them.

Out of the box each leg is a **straight line**: a distance, no time, and `estimate: true`. A
real journey is longer. Nothing leaves your server.

A leg between two stops that are both known only as the **same town** has no length anybody can
honestly give. It is answered as `unknown`, never as zero, and says why: `why: "same-town"`. A
map's list reads "both stops are pinned to the town; place them to measure", in the viewer's
language. Placing either stop (a dragged pin, or a place picked from the search) makes it an
exact point, and the leg is measured. Send each stop's `by` and, for a town, its `placeId`: two
stops of one town are recognised by the town's id, and without one only at the very same point.

### Routes along roads

Switch on **Settings → Maps → Routes along roads** and your Adminium server asks the **routing
server** for the road route: distances, times, and the line to draw. By default that is
`https://router.project-osrm.org`, the OSRM project's public demo server.

What the routing server learns: your **server's address** and the **ordered positions of the
route's stops**. Not the viewer's address (the request is made by your server, not their
browser), no name, no row.

Adminium asks it once for one set of stops and keeps the answer for a day, and never asks more
than once a second. If the routing server is slow, down or answers something unexpected, the
legs come back as straight lines with `fellBack: true`. A leg to or from a stop known by town
stays marked as an estimate even along roads.

The public demo server is for trying things out; it makes no promise of being there. For daily
use, host your own.

## Hosting your own

Both servers are open source and both are one environment variable:

```bash
ADMINIUM_MAP_SERVER=https://tiles.example.com
ADMINIUM_ROUTING_SERVER=http://osrm.internal:5000
```

- **Map server.** Anything that serves an [OpenFreeMap](https://openfreemap.org/)-compatible
  style and its tiles. It must be `https://` (browsers refuse to mix), and reachable from your
  staff's browsers, not only from the server.
- **Routing server.** An [OSRM](https://project-osrm.org/) (`/route/v1/driving/…`). It is called
  by your Adminium server, so it can sit on a private network and can be plain `http://`. In
  production a routing server on the same machine is named by a network name, not by
  `localhost`: Adminium refuses loopback addresses for calls it makes on somebody's behalf.

With both set to your own servers, a map tells nobody outside your network anything.

→ [`ADMINIUM_MAP_SERVER`](/self-hosting/env-vars/#adminium_map_server) ·
[What Adminium connects to](/self-hosting/telemetry/#what-adminium-connects-to-when-telemetry-is-off)
