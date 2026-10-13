---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/widgets': patch
'@adminium/add-on-contracts': patch
'@adminium/i18n': patch
---

Maps come from a map server the operator names (OpenFreeMap by default, `ADMINIUM_MAP_SERVER`), and the page's security policy names it only while maps are on: Settings → Maps, the desktop app and `ADMINIUM_MAP_SERVER=off` each switch them off, and then no outside server is named at all. A column can hold a place (`{ lat, lng, by }`, where a town's position is always the server's own) or an area (a GeoJSON polygon). Towns are found by name from a list of 170,000 places that ships with the server, with no site asked. The way between stops is straight-line estimates until routes along roads are switched on, and a leg inside one town is unknown, never zero.
