<!-- produced from apps/server/openapi.json (paths under /api/v1/public); do not edit -->

# The public API: every route

Every request carries the browser key: `Authorization: Bearer <publishable key>`. A customer screen
does not call these by hand: `@adminiumjs/public-client` wraps them. This table is for checking
that a route exists and what it answers.

| Method | Path | What | Answers |
|---|---|---|---|
| `GET` | `/api/v1/public-api` |  | 200 |
| `PUT` | `/api/v1/public-api` |  | 200 |
| `GET` | `/api/v1/public-api/stats` |  | 200 |
| `GET` | `/api/v1/public-endpoints` |  | 200 |
| `POST` | `/api/v1/public-endpoints/check` |  | 200 |
| `PUT` | `/api/v1/public-endpoints/{connectionId}/{ref}` |  | 200 |
| `DELETE` | `/api/v1/public-endpoints/{connectionId}/{ref}` |  | 200 |
| `POST` | `/api/v1/public-endpoints/{connectionId}/{ref}/rename` |  | 200 |
| `GET` | `/api/v1/public-keys` |  | 200 |
| `POST` | `/api/v1/public-keys` |  | 201 |
| `DELETE` | `/api/v1/public-keys/{id}` |  | 200 |
| `GET` | `/api/v1/public-keys/{id}/reveal` |  | 200 |
| `POST` | `/api/v1/public-keys/{id}/rotate` |  | 200 |
| `GET` | `/api/v1/public-scopes` |  | 200 |
| `POST` | `/api/v1/public-scopes` |  | 201 |
| `PATCH` | `/api/v1/public-scopes/{id}` |  | 200 |
| `DELETE` | `/api/v1/public-scopes/{id}` |  | 200 |
| `DELETE` | `/api/v1/public/account` |  | 200, 401, 403, 404, 409, 429, 503 |
| `GET` | `/api/v1/public/add-ons/{key}/settings` |  | 200, 401, 403, 404, 429, 503 |
| `GET` | `/api/v1/public/availability/{ref}` |  | 200, 400, 401, 403, 404, 429, 503 |
| `GET` | `/api/v1/public/challenge` |  | 200, 400, 401, 429, 503 |
| `POST` | `/api/v1/public/claim` |  | 200, 401, 403, 429, 503 |
| `POST` | `/api/v1/public/claim/code` |  | 200, 400, 401, 403, 404, 409, 429, 503 |
| `POST` | `/api/v1/public/claim/link` |  | 202, 400, 401, 403, 429, 503 |
| `POST` | `/api/v1/public/claim/link/peek` |  | 200, 401, 403, 410, 429, 503 |
| `POST` | `/api/v1/public/claim/link/resend` |  | 202, 401, 403, 429, 503 |
| `POST` | `/api/v1/public/claim/link/verify` |  | 200, 401, 403, 410, 429, 503 |
| `POST` | `/api/v1/public/claim/token` |  | 200, 401, 403, 404, 410, 429, 503 |
| `POST` | `/api/v1/public/claim/verify` |  | 200, 401, 403, 404, 410, 429, 503 |
| `GET` | `/api/v1/public/config` |  | 200, 401, 403, 429, 503 |
| `GET` | `/api/v1/public/documents` |  | 200, 400, 401, 404, 429, 503 |
| `POST` | `/api/v1/public/documents/render` |  | 200, 201, 400, 401, 403, 404, 429, 503 |
| `GET` | `/api/v1/public/documents/{id}` |  | 200, 401, 404, 429, 503 |
| `GET` | `/api/v1/public/documents/{id}/content` |  | 401, 404, 429, 503 |
| `POST` | `/api/v1/public/documents/{id}/email` |  | 200, 401, 404, 429, 503 |
| `GET` | `/api/v1/public/files/{ref}/{rowId}/{column}` |  | 401, 403, 404, 429, 503 |
| `GET` | `/api/v1/public/pictures/{keyId}/{ref}/{rowId}/{column}/{fileId}` |  | 404, 429, 503 |
| `GET` | `/api/v1/public/records/{ref}` |  | 200, 401, 404, 429, 503 |
| `POST` | `/api/v1/public/records/{ref}` |  | 200, 201, 400, 401, 403, 404, 409, 429, 503 |
| `POST` | `/api/v1/public/records/{ref}/batch` |  | 200, 400, 401, 403, 404, 429, 503 |
| `POST` | `/api/v1/public/records/{ref}/dry-run` |  | 200, 400, 401, 403, 404, 409, 429, 503 |
| `GET` | `/api/v1/public/records/{ref}/{id}` |  | 200, 401, 404, 429, 503 |
| `PATCH` | `/api/v1/public/records/{ref}/{id}` |  | 200, 400, 401, 404, 409, 429, 503 |
| `PUT` | `/api/v1/public/records/{ref}/{id}` |  | 200, 400, 401, 404, 409, 429, 503 |
| `DELETE` | `/api/v1/public/records/{ref}/{id}` |  | 200, 400, 401, 404, 429, 503 |
| `POST` | `/api/v1/public/records/{ref}/{id}/dry-run` |  | 200, 400, 401, 404, 409, 429, 503 |
| `POST` | `/api/v1/public/records/{ref}/{id}/new-link` |  | 202, 401, 403, 404, 409, 429, 503 |
| `DELETE` | `/api/v1/public/session` |  | 200, 401, 429, 503 |
| `POST` | `/api/v1/public/session/revoke-all` |  | 200, 401, 403, 404, 429, 503 |
