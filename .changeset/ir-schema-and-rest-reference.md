---
'@adminium/schema-import': patch
'@adminium/engine': patch
---

Publish the IR JSON Schema the import guide has always pointed at, and accept the
`$schema` key it tells you to write.

`guides/schema-import/json-ir.md` has advertised
`https://adminium.dev/schemas/ir-v1.json` since the page was written and no such
document was ever generated — the URL 404'd. It is now derived from
`databaseModelSchema` itself (`packages/engine/scripts/ir-json-schema.mjs`,
committed as `ir-v1.schema.json` and served at
`https://docs.adminium.dev/schemas/ir-v1.json`), so the published contract cannot
disagree with the parser that enforces it. `--check` and a unit test both gate
the artifact, for the same reason `openapi.json --check` exists.

The page also told readers to reference it with `"$schema": "…"`, which made the
document unimportable: every IR object is a Zod `strictObject`, so the key the
guide recommended failed at `<root>: Unrecognized key: "$schema"`. `parseJsonIr`
now strips a top-level string `$schema` — and only there, so snapshots and LLM
responses keep the strict path. A non-string `$schema` is still someone's data
and still fails loudly.
