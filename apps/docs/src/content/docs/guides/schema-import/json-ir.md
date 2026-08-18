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

The IR is the `DatabaseModel` schema itself, and it is **strict**: an unknown
key is an error, not a warning. Everything below except `dialect`, `name`,
`tables`, and each table's `name`/`columns` has a default, so a hand-written
document stays small.

```json title="acme.json"
{
  "$schema": "https://docs.adminium.dev/schemas/ir-v1.json",
  "irVersion": 1,
  "dialect": "postgres",
  "name": "acme",
  "enums": [
    {
      "id": "public.user_status",
      "name": "user_status",
      "values": ["active", "suspended"]
    }
  ],
  "tables": [
    {
      "schema": "public",
      "name": "orgs",
      "columns": [
        {
          "name": "id",
          "dbType": "uuid",
          "logicalType": "uuid",
          "nullable": false,
          "isPrimaryKey": true
        }
      ],
      "primaryKey": ["id"]
    },
    {
      "schema": "public",
      "name": "users",
      "columns": [
        {
          "name": "id",
          "dbType": "uuid",
          "logicalType": "uuid",
          "nullable": false,
          "isPrimaryKey": true
        },
        {
          "name": "email",
          "dbType": "text",
          "logicalType": "text",
          "nullable": false,
          "isUnique": true,
          "comment": "Login address"
        },
        {
          "name": "status",
          "dbType": "user_status",
          "logicalType": "enum",
          "enumRef": "public.user_status",
          "nullable": false,
          "default": { "kind": "literal", "text": "active" }
        },
        {
          "name": "org_id",
          "dbType": "uuid",
          "logicalType": "uuid",
          "nullable": false,
          "references": { "tableId": "public.orgs", "column": "id" }
        }
      ],
      "primaryKey": ["id"]
    }
  ],
  "relations": [
    {
      "id": "public.users.org_id->public.orgs.id",
      "kind": "declared-fk",
      "cardinality": "one-to-many",
      "from": { "tableId": "public.users", "columns": ["org_id"] },
      "to": { "tableId": "public.orgs", "columns": ["id"] },
      "onDelete": "cascade"
    }
  ]
}
```

Four things in there are easy to get wrong, and all four are hard errors:

- **`dialect` and `name` are required.** Use `"generic"` when your source is not
  a specific database.
- **Column type lives in two fields.** `dbType` is the verbatim native type;
  `logicalType` is one of the closed set Adminium reasons over (`text`,
  `integer`, `uuid`, `timestamptz`, `enum`, …). There is no `type` key.
- **`default` is an object**, not a bare value: `{ "kind": "literal", "text":
  "active" }`, or `{ "kind": "expression", "text": "now()" }`, or one of the
  shorthands `{ "kind": "autoincrement" | "now" | "uuid" }`.
- **Foreign keys are stated on the column, and optionally as a relation.**
  There is no `foreignKeys` array on a table. `references` is the mirror the
  generator reads; a `relations` entry additionally carries cardinality and
  referential actions. Both must point at a table and column that exist in the
  same document — dangling references are rejected, so an IR file cannot
  describe half a schema.

The smallest document Adminium accepts is much shorter:

```json title="tiny.json"
{
  "irVersion": 1,
  "dialect": "generic",
  "name": "tiny",
  "tables": [{ "name": "users", "columns": [{ "name": "id" }] }]
}
```

## Validate before you import

The schema is published as JSON Schema, generated from the same Zod model that
validates the import — so it cannot disagree with what Adminium accepts:

```
https://docs.adminium.dev/schemas/ir-v1.json
```

Reference it with `$schema` and your editor validates as you type. Adminium
strips that one key on import; every *other* unknown key is still an error.

```json title="my-schema.json"
{
  "$schema": "https://docs.adminium.dev/schemas/ir-v1.json",
  "irVersion": 1,
  "dialect": "generic",
  "name": "my-schema",
  "tables": [{ "name": "users", "columns": [{ "name": "id" }] }]
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
