---
title: Import the JSON IR
description: Adminium's intermediate representation — the format every import converts to, and a first-class import format itself.
---

Every import — live introspection, `pg_dump`, Prisma, Django — converges on one
**intermediate representation**: a JSON document describing tables, columns,
types, keys, and relations. Everything downstream reads the IR, not your
original file.

You can also write it directly. That makes the IR the escape hatch for any
schema Adminium cannot parse: emit the IR from whatever your source of truth is,
and the rest of the pipeline works unchanged.

## Shape

```json
{
  "irVersion": 1,
  "tables": [
    {
      "id": "public.users",
      "schema": "public",
      "name": "users",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "nullable": false,
          "primaryKey": true
        },
        {
          "name": "email",
          "type": "text",
          "nullable": false,
          "unique": true,
          "description": "Login address"
        },
        {
          "name": "status",
          "type": "enum",
          "nullable": false,
          "enumValues": ["active", "suspended"],
          "default": "active"
        }
      ],
      "foreignKeys": [
        {
          "columns": ["org_id"],
          "referencesTable": "public.orgs",
          "referencesColumns": ["id"]
        }
      ]
    }
  ]
}
```

The authoritative schema is published as JSON Schema, so you can validate before
importing and get editor completion while writing:

```
https://adminium.ai/schemas/ir-v1.json
```

```json title="my-schema.json"
{
  "$schema": "https://adminium.ai/schemas/ir-v1.json",
  "irVersion": 1,
  "tables": []
}
```

## Detection

Adminium detects the IR by a JSON document with an `irVersion` or `tables` key.

## `irVersion` is a contract

`irVersion: 1` is frozen. A document declaring version 1 will import into every
future Adminium that supports version 1, unchanged. When the IR gains a version
2, version-1 documents keep importing — new fields are additive, and Adminium
migrates old documents forward rather than rejecting them.

Pin it. An IR document without `irVersion` is assumed to be the current version,
which is fine today and a bug the day that changes.

## When to use it

- **Your ORM is not in the list.** Emit the IR from your own metadata.
- **Your schema is generated.** The formats that lose to
  [static analysis](/guides/schema-import/drizzle/#the-static-analysis-limit) —
  Drizzle, TypeORM, Sequelize, Django — all lose to computed definitions.
  Nothing stops you from *running* your code and emitting the IR yourself; that
  is the one thing Adminium will not do for you.
- **You want a schema in source control** that Adminium reads, reviewed like any
  other file.
- **You are testing.** A hand-written IR gives you an app over a schema that
  does not exist yet.

## Round-tripping

`adminium introspect --connection <id> --out schema.json` writes the snapshot's
schema as JSON. That file is IR, so it re-imports:

```bash
adminium introspect --connection prod-db --out schema.json
# Snapshot snp_… stored — 24 tables, checksum a3f2c1d90e4b.
# Wrote /path/to/schema.json
```

Useful for moving a schema across an air gap: introspect where the database is
reachable, import where Adminium runs.

## See also

- [Import a schema file](/guides/schema-import/) — the overview and type-mapping
  matrix
- [`adminium introspect`](/reference/cli/#introspect)
