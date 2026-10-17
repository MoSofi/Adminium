<!-- produced from apps/docs/src/content/docs/guides/apps/maps.md § Hosting your own; do not edit -->

# Maps, places and routes: Hosting your own

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

→ [`ADMINIUM_MAP_SERVER`](https://docs.adminium.dev/self-hosting/env-vars/#adminium_map_server) ·
[What Adminium connects to](https://docs.adminium.dev/self-hosting/telemetry/#what-adminium-connects-to-when-telemetry-is-off)
