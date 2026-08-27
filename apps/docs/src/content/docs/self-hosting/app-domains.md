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

3. **Point DNS and the proxy.** The mapping is inert until traffic actually arrives carrying that
   `Host` — Adminium states the prerequisite rather than probing it.

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
