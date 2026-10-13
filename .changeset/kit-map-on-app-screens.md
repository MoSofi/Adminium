---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/widgets': patch
---

The map can be mounted on an app's own staff screen: `mount('map', element, props)`. The screen gives pins and areas as plain data and the `maps` of its side's config; it hears a pick in `onSelect` and saves a dragged pin in `onMovePin`, and a save it answers `{ refused }` (or rejects) puts the pin back and says the reason above the map and to a screen reader. With maps switched off the part shows its list and asks nothing of the map server; when that server cannot be reached it shows the list and says so. A route's legs come from a function the screen gives (`POST /api/v1/geo/route`), and `update` leaves the person's view, the picked pin and a pin being dragged as they were. The map's sheet holds the map library's own styles under the kit's wrapper, so nothing outside it is styled. The dashboard's two-factor step is now fetched when it is needed instead of with the first paint.
