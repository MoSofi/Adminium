<!-- produced from apps/docs/src/content/docs/guides/apps/maps.md § The map server; do not edit -->

# Maps, places and routes: The map server

A map is drawn in the browser from pictures (tiles) of the part of the world on screen. They
come from the **map server**, by default `https://tiles.openfreemap.org`, a free service that
needs no key.

What the map server learns: the **viewer's address** (their IP) and **which part of the world
they looked at**, at which zoom. It is never sent a row, a name, an address from your data, or
where your pins are: the pins are drawn by the browser on top of the pictures.

The map server's address is set by whoever runs the server, with
[`ADMINIUM_MAP_SERVER`](https://docs.adminium.dev/self-hosting/env-vars/#adminium_map_server), and is shown in
**Settings → Maps**. It cannot be typed into the dashboard. That is deliberate: the address is
written into the page's security policy, which is what lets a browser talk to it at all, and a
box anyone with the settings permission could type an address into would be a way to let every
staff browser talk to any server.

While maps are on, that policy carries the map server's address on every page, the sign-in page
too, so the address is not a secret from somebody who is not signed in. While maps are off,
nothing the server sends names it.
