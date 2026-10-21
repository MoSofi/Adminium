<!-- produced from apps/docs/src/content/docs/self-hosting/payments.md § Behind a proxy; do not edit -->

# Payments on your server: Behind a proxy

Set `ADMINIUM_TRUST_PROXY=on` when Adminium runs behind Caddy, nginx or a load balancer. See
[Behind a reverse proxy](https://docs.adminium.dev/self-hosting/reverse-proxy/).

A pay link carries its token in the path, `/pay/<token>`. Adminium leaves the token out of its own
request log. Your proxy's access log is yours: leave `/pay/` paths out of it, or keep that log
private, because a token there opens the pay page.
