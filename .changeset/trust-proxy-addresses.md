---
'@adminium/server': patch
'@adminium/desktop': patch
---

**`ADMINIUM_TRUST_PROXY=on` works again on npm installs.** Since Fastify 5.12.1
(18 August), a fresh `npm install @adminiumjs/adminium` ignored the proxy
completely. Checked on 0.2.5 behind Caddy: the audit log recorded every request
as coming from `127.0.0.1`, the session cookie was set over HTTPS without
`Secure`, and everyone behind the proxy shared one login rate limit. Adminium
told Fastify to trust "one hop". Fastify 5.12.1 stopped honouring hop counts,
because a hop count cannot tell the proxy from a client that connects directly
(GHSA-3m5p-2c4r-xxw2). The Docker image kept working because its lockfile still
had Fastify 5.12.0. On that version a client that could reach the port directly
could set its own address, scheme and host.

A connection now counts as the proxy only when it comes from a trusted address,
and Adminium takes only the address that proxy added to `X-Forwarded-For`. The
new `ADMINIUM_TRUSTED_PROXIES` lists those addresses. The default,
`loopback,uniquelocal`, covers a proxy on the same host and one on a Docker or
other private network. Set it to your proxy's address to trust nothing else.
From any other address, `X-Forwarded-For`, `X-Forwarded-Proto`,
`X-Forwarded-Host` and `X-Request-Id` are ignored. A bad entry, or a list set
while `ADMINIUM_TRUST_PROXY` is off, stops the boot and says why. The desktop app
removes the variable from the environment it starts the server with, as it
already does for `ADMINIUM_TRUST_PROXY`.

Fastify is now 5.12.5, and npm installs get at least that. It also brings the
fixes for GHSA-w2qp-rph6-63g4 and the 5.12.2 and 5.12.5 security releases.
`@fastify/proxy-addr` is at least 5.1.1 (GHSA-jqcg-44mw-7w3h).

The nginx example in the reverse-proxy guide now sets `X-Forwarded-Host`.
Without that line, nginx passes on whatever the client sent.
