<!-- produced from apps/docs/src/content/docs/guides/apps/maps.md § The link out to a maps app; do not edit -->

# Maps, places and routes: The link out to a maps app

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
([`mapsSiteLink`](https://docs.adminium.dev/guides/apps/kit-parts/#open-in-my-maps-app)).
