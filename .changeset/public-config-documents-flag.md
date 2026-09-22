---
'@adminium/server': patch
---

**`GET /api/v1/public/config` now sends the `documents` capability.**

The scope projection has computed `documents: { create }` since 0.2.6, but the
route's reply schema never declared it, and the serializer parses through that
schema, so the field was stripped from every response. Pages built on
`@adminium/public-client` saw every server as one too old to draw documents
and never offered "email me a copy".

The reply schema and the OpenAPI spec now declare it. A scope that says
nothing sends `{ create: false }`, never an absent key. `PublicConfig.documents`
stays optional in the client, because every server up to 0.3.0-rc.2 still
omits it.
