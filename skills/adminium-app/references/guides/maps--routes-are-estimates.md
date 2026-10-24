<!-- produced from apps/docs/src/content/docs/guides/apps/maps.md § Routes are estimates; do not edit -->

# Maps, places and routes: Routes are estimates

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
