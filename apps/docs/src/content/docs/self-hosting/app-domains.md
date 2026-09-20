---
title: An app surface on its own domain
description: Attach shop.example.com or staff.example.com to a hosted app surface — DNS and TLS stay on your proxy; Adminium routes by Host.
sidebar:
  order: 6
---

An app surface Adminium hosts at `/apps/<app>/<side>/` can also answer on a domain of its own —
`shop.example.com` for a customer surface, `staff.example.com` for a staff one — with **zero
rebuilds and zero rewrite rules**. Adminium reads the `Host` header and serves the mapped surface's
pages itself; the dashboard keeps working on every host you did not map.

## How the pieces divide

- **Your DNS** points the domain at your reverse proxy.
- **Your proxy** terminates TLS and passes the request through **with the `Host` header intact**.
  Certificates never involve Adminium.
- **Adminium** serves the surface for that host: every path renders the surface (deep links
  included), while `/api/*`, `/apps/*` and the sign-in pages keep their normal meaning.

With Caddy the site block is two lines, because `reverse_proxy` preserves `Host` by default:

```text
staff.example.com {
  reverse_proxy adminium:4600
}
```

For nginx, set `proxy_set_header Host $host;` — the pass-through is the whole requirement.

## Setting it up

1. **Let the surfaces call the API.** A page served by Adminium itself is *same-origin*, which no
   cross-origin allow-list can express, so the origins variable has a sentinel for it:

   ```bash
   ADMINIUM_PUBLIC_API_ORIGINS=self
   ```

   That is the entire posture for an instance whose only public consumers are the surfaces it
   hosts. Append real origins beside it only for standalone pages deployed elsewhere.
   → [Environment variables](/self-hosting/env-vars/#adminium_public_api_origins)

2. **Attach the domain in Studio.** *Studio → Hosted apps → Domains*: enter the host, pick the
   surface, save. The mapping takes effect within a few seconds. Adminium refuses the host you are
   using to reach Studio — mapping it would take the dashboard away from you.

3. **Point DNS at this server.** Add the record for the new host with the same type and target as
   the address you already use for the dashboard — if `admin.example.com` is an `A` record at your
   server's IP, `staff.example.com` is the same `A` record at the same IP. Check it from a public
   resolver rather than the machine you are working on, because a local or router cache holds a
   negative answer for a long time after the record exists:

   ```bash
   dig @1.1.1.1 +short staff.example.com
   ```

4. **Add the site block, then reload the proxy.** A running proxy does not re-read its
   configuration on its own, so an edited file changes nothing until you reload it. With Caddy in
   Docker:

   ```bash
   docker exec <caddy-container> caddy validate --config /etc/caddy/Caddyfile
   docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
   ```

   Do this **after** DNS resolves: a certificate authority validates the name over the public
   internet, so a proxy reloaded first simply fails the challenge and retries.

The mapping itself is inert until traffic actually arrives carrying that `Host` — Adminium states
the prerequisite rather than probing it.

For a **customer** surface, also make sure a publishable key is bound to the app (*Studio → Public
API*, mint a key and bind it to the app surface). The surface fetches its key from the server at
load time, so rotating it later is Studio + reload — no rebuild.

## What a mapped staff domain does about sign-in

Sessions are cookies, and cookies are per-host: a session on `admin.example.com` does not ride to
`staff.example.com`. So on a mapped host a short reserved set still serves the dashboard — the
sign-in pages (`/login`, `/otp`, `/forgot`, `/reset`) plus `/api/*` and `/apps/*`. Opening a staff
domain anonymously redirects to the login page *on that domain*; signing in (same credentials) sets
the cookie *for that domain* and returns you to the page you asked for. One extra sign-in per
domain is the cost of the placement.

Everything else about the dashboard is deliberately **not** reachable on a mapped host — workspace
management happens on the admin host. And because the dashboard still serves normally on every
unmapped host, a mistaken mapping is always recoverable from the host you did not map.

## When the domain serves nothing

Three layers have to line up, and each one fails differently. Check them in this order — the answer
from a later layer is meaningless while an earlier one is wrong.

### 1. Does the name resolve?

```bash
dig @1.1.1.1 +short staff.example.com
```

Name the resolver explicitly. Your machine's own resolver can keep answering `NXDOMAIN` for hours
after you add the record, so `dig` and a browser on the same laptop will disagree — and the browser
is the one that is wrong. To test HTTPS before your resolver catches up, skip it:
`curl --resolve staff.example.com:443:<ip> https://staff.example.com/`.

### 2. Is Adminium routing that host?

Ask the server directly, from inside its own container, which takes DNS and TLS out of the picture.
The official image is Debian-slim with no `curl`, so use node — the same reason the image's own
health check does:

```bash
docker exec <adminium-container> node -e "require('http').get({host:'127.0.0.1',port:4600,path:'/',headers:{Host:'staff.example.com',Accept:'text/html'}},r=>{console.log(r.statusCode,r.headers.location||'');process.exit(0)})"
```

**Read this one carefully, because the obvious reading is backwards:**

| Response | Meaning |
|---|---|
| `302 /login?next=%2F` | The mapping works. A staff surface with no session redirects to its own login page. |
| `401` | **Also the mapping working.** The gate only redirects for a browser navigation — a request carrying `sec-fetch-mode: navigate`, or an `Accept` holding `text/html`. Anything else gets the API envelope instead. Drop the `Accept` header above and you will see this. |
| `200` | **This is the failure.** The host matched no mapping, so it fell through to the dashboard. Check the host spelling in Studio, and that the surface it points at still exists. |

A `curl` to `localhost:4600` on the host machine usually answers `Connection refused`, and that is
correct rather than broken: with a proxy in the same Docker network, Adminium's port is not
published to the host at all.

### 3. Does the proxy have a certificate?

From outside:

```bash
curl -sS -o /dev/null -D - --resolve staff.example.com:443:<ip> https://staff.example.com/
```

A TLS error such as `tlsv1 alert internal error` — rather than any HTTP status — means the proxy has
no certificate for that name, which almost always means its site block is not loaded. Confirm the
running process can see the block, then reload it:

```bash
docker exec <caddy-container> cat /etc/caddy/Caddyfile
docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
```

If the block is missing from that output, the file you edited is not the one the container has
mounted. If it is present and the reload still does not produce a certificate, watch the challenge:
`docker logs -f <caddy-container>` should show `obtaining certificate` then `certificate obtained
successfully`. Failures there are usually port 80 not reaching the proxy from the internet — the
HTTP-01 challenge needs it even though your own traffic is HTTPS.
