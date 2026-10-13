<!-- produced from apps/docs/src/content/docs/guides/apps/maps.md § What works with nothing set up; do not edit -->

# Maps, places and routes: What works with nothing set up

| | Asks another server? |
|---|---|
| Finding a town by name (`GET /api/v1/geo/places`) | **No.** The list of towns ships with Adminium. |
| Keeping a place or an area in a column | **No.** A pasted map link is read as text; it is never opened. |
| The way between stops, as straight lines | **No.** |
| Drawing a map | **Yes: each viewer's browser** fetches the map's pictures from the map server. |
| The way between stops along roads | **Yes: your Adminium server** asks the routing server. Off until you switch it on. |
