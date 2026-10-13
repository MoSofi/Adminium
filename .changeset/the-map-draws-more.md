---
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/server': patch
'@adminium/engine': patch
'@adminium/ui': patch
'@adminium/i18n': patch
'@adminium/desktop': patch
---

The map is drawn by MapLibre from the install's map server, in the light or dark style, and Leaflet and the CARTO tiles are gone: the server's address reaches a signed-in page with the session and is written nowhere in the build. A map is never a blank frame: when the map server cannot be reached the list of places is shown under "The map could not be reached. Here is the list.", and with maps switched off (Settings → Maps, the operator, or the desktop app) the list is shown under "Maps are switched off", with no map code fetched and nothing asked outside. `MapView` also draws pins known only by their town (hollow, "by town", spread in a ring when several share one), a pin dragged to the exact spot (`onPlace`), areas and the drawing of one (`areas`, `onAreaChange`), and a route with each leg's length (`route`, `units`: "about" for a straight line, "unknown" where there is none). A record's place column gets a field of its own (type a town, paste coordinates or a map link, "Where I am", or drag the pin) and an area column the drawing of the shape; a list shows a place by its name and an area by its point count. Settings → Maps has the two switches and says which server learns what.
