---
title: Behind a reverse proxy
description: Terminate TLS with Caddy or nginx, and set ADMINIUM_TRUST_PROXY so Adminium reads forwarded headers correctly.
sidebar:
  order: 5
---

Adminium does not terminate TLS. Put a reverse proxy in front of it.

## The one setting people miss

```bash
ADMINIUM_TRUST_PROXY=on
```

Without it, Adminium sees every request as coming from your proxy's IP. Your
audit log records the proxy. Rate limits apply to the proxy. Secure-cookie
handling assumes plain HTTP.

With it, Adminium reads `X-Forwarded-For` and `X-Forwarded-Proto` and gets the
real client.

:::caution[Only turn it on when a proxy you control is actually in front]
`X-Forwarded-For` is a header. Anyone can send one. It is trustworthy only when
something you control overwrites it on the way in.

Set `ADMINIUM_TRUST_PROXY=on` while Adminium is reachable directly, and any
client can forge its source IP — appearing in your audit log as whatever it
likes, and evading per-IP limits. That is why it is off by default.

Turn it on **and** make sure Adminium's port is not reachable except through the
proxy.
:::

## Caddy

```text title="Caddyfile"
admin.example.com {
	reverse_proxy 127.0.0.1:4600
}
```

That is the whole file. Caddy gets a certificate, redirects HTTP to HTTPS, sets
the forwarded headers, and renews automatically.

```bash
ADMINIUM_TRUST_PROXY=on HOST=127.0.0.1 adminium start
```

`HOST=127.0.0.1` binds loopback only, so the only route in is through Caddy.
Combine the two and the trust setting is safe by construction.

## nginx

```nginx
server {
    listen 443 ssl http2;
    server_name admin.example.com;

    ssl_certificate     /etc/letsencrypt/live/admin.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4600;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket — required for realtime updates.
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 3600s;
    }
}

server {
    listen 80;
    server_name admin.example.com;
    return 301 https://$host$request_uri;
}
```

The `Upgrade`/`Connection` headers and the long `proxy_read_timeout` are not
optional. Without them the WebSocket fails to establish or is killed after 60
seconds, and the UI silently stops updating — it does not error, it just goes
stale. If your instance "does not refresh", this is why.

## Under Docker

Do not publish Adminium's port to the world. Put the proxy on the same network
and let it reach the container:

```yaml
services:
  adminium:
    image: ghcr.io/mosofi/adminium:0.1.0
    environment:
      ADMINIUM_SECRET: ${ADMINIUM_SECRET:?}
      ADMINIUM_TRUST_PROXY: 'on'
    expose:
      - '4600'          # network-internal, not published to the host

  caddy:
    image: caddy:2
    ports: ['80:80', '443:443']
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
```

```text title="Caddyfile"
admin.example.com {
	reverse_proxy adminium:4600
}
```

Note `expose` rather than `ports` on the Adminium service — that is what makes
`ADMINIUM_TRUST_PROXY=on` safe here.

## Health checks

```
GET /api/v1/healthz
```

Check the **body** for `ok: true`, not just the status. Bare `/healthz` has no
route and is answered by the SPA history fallback with a 200 — a probe pointed
there passes even when the meta store is unreachable.

## A subpath is not supported

Adminium expects to own its origin (`admin.example.com`), not a subpath
(`example.com/adminium`). Give it a subdomain.

## CORS

You do not need it. The dashboard is served by the same process as the API, so
it is same-origin — which is why CORS is off by default.

The exception is a split deployment where the dashboard is served from a
different origin:

```bash
ADMINIUM_CORS_ORIGINS='https://admin.acme.io'
```

Exact origins only. `*` is rejected: responses are credentialed, and a wildcard
origin with credentials is not a configuration, it is a mistake.
