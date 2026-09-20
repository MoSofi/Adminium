---
'@adminium/server': patch
---

An operator names each hosted app from Adminium, and dates stop defaulting to UTC.

An app shipped the name it was built with — "Outline", "Wren House" — and
changing it meant rebuilding the bundle. Studio → Hosted apps now carries an
**App names** card; the name reaches the app's own screens, its browser tab and
this dashboard's sidebar, and clearing it restores whatever the app ships.

A connection with no timezone rendered every date in UTC, decided in the
browser. Every connection now reports this server's own zone, which a surface
falls back to and reports as unconfirmed, and Studio's Connections card names
the zone in use instead of showing an empty field.

The Domains card links to the setup guide and, once a mapping is saved, lists
the three things Adminium cannot do for you: point DNS at this server, give the
host a proxy site block and reload the proxy, and sign in again on that host.
