---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/docs': patch
---

**Public API keys can be made from endpoints instead of a hand-written scope.**

Every table and view of a connection now has a generated public endpoint:
its columns (none marked secret or personal data), its filters, page size,
order, rate limit and response shape, and the methods its source supports.
An operator can store an edited endpoint or a new custom one, and a key can
be given several endpoints with different methods on each. Adminium writes the
key's scope from those grants.

New admin routes, all behind the API-keys permission:

- `GET /api/v1/public-endpoints?connectionId=` lists the endpoints, the
  source tables and their columns, and any table without a generated endpoint
  with the reason.
- `POST /api/v1/public-endpoints/check` compiles a definition without saving
  it. It reports every issue, the live keys a save would break, and the
  browser keys that would gain columns, methods or rows.
- `PUT /api/v1/public-endpoints/:connectionId/:ref` saves an endpoint and
  rewrites the scope of every live key that uses it in the same step. A save
  that would break one of those keys is refused, and the reply names the key.
- `POST …/:ref/rename` and `DELETE …/:ref` are refused while a live key uses
  the endpoint. Deleting a generated endpoint switches it off instead of
  removing it, so its default does not come back.
- `POST /api/v1/public-keys` also accepts `connectionId` with `access` (the
  endpoints and methods), next to the existing `scopeId`.

`GET /api/v1/public-keys` now returns each key's connection, kind, what it can
call on each endpoint (and any method the endpoint no longer offers), and any
issue that stops the key from working today.

A key's derived scope is not listed by `GET /api/v1/public-scopes` and cannot
be edited, deleted or reused by another key.

Scopes also gain a default page size (`defaultLimit`), a default order
(`defaultOrder`), a per-resource rate (`rate`) and a list response shape
(`response`), and the `replace`, `delete` and `batch` actions. All are
optional; a scope written before this change behaves as it did. The routes
that serve the three new actions come in a later release.
`GET /public/config` reports each resource's response shape.

With more than one server process, a revoke, rotate, key create or endpoint
save now reaches the other processes within 5 seconds (it was 30).
