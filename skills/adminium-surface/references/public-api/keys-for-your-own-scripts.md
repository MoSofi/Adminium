<!-- produced from apps/docs/src/content/docs/guides/public-api/endpoints-and-keys.md § Keys for your own scripts; do not edit -->

# Endpoints and keys: Keys for your own scripts

The public API is for pages and integrations that act on a few tables. A script that
should act as a user — with a role's permissions across the whole REST API — needs a
**role-bound** key (`adm_sk_…`) instead. There is no page for those; mint one with the
REST API from a signed-in session:

```bash
curl -c jar.txt -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"…"}' \
  https://admin.example.com/api/v1/auth/login
curl -b jar.txt https://admin.example.com/api/v1/roles
curl -b jar.txt -H 'content-type: application/json' \
  -d '{"name":"Nightly sync","roleId":"<role id>"}' \
  https://admin.example.com/api/v1/api-keys
```

The reply carries the key once. See the [REST API reference](https://docs.adminium.dev/reference/rest-api/#authentication).
