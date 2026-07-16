---
title: Import a Drizzle schema
description: Import a Drizzle schema.ts. Table builders, relations, and the limits of reading TypeScript statically.
---

## The file

Your Drizzle schema module — usually `src/db/schema.ts`.

## Detection

Adminium detects Drizzle by `pgTable(`, `mysqlTable(`, or `sqliteTable(` calls.

## What is read

| Drizzle | Becomes |
|---|---|
| `pgTable` / `mysqlTable` / `sqliteTable` | table |
| Column builders (`text()`, `integer()`, `timestamp()`, …) | columns |
| `.primaryKey()` | primary key |
| `.references(() => other.id)` | foreign key + relation |
| `.notNull()` | non-nullable |
| `.unique()` | unique constraint |
| `.default(…)` | default |
| `pgEnum` | enum → select input |
| The first string argument | **the real table/column name** |

```ts
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  emailAddr: text('email_address').notNull().unique(),
});
```

Adminium imports `users.email_address` — the string, not the TypeScript key —
because that is the column that exists.

## The static-analysis limit

Drizzle schemas are **TypeScript programs**, and Adminium parses them without
executing them. That is a deliberate safety property: importing a schema file
must never run code. It has a cost.

Anything computed at runtime is invisible:

```ts
// Read correctly — the literal is right there.
export const users = pgTable('users', { … });

// Not read — the name is a runtime value.
const TABLE = `${prefix}_users`;
export const users = pgTable(TABLE, { … });

// Not read — a loop the parser does not run.
const cols = Object.fromEntries(FIELDS.map((f) => [f, text(f)]));
```

Helper functions, spreads from other modules, and conditional column sets fall
into the same category. If your schema is mostly literal — which most are — the
import is faithful. If it is generated, use a
[SQL dump](/guides/schema-import/sql-ddl/) or the
[JSON IR](/guides/schema-import/json-ir/) instead.

## `relations()` is not a foreign key

Drizzle separates the query-layer `relations()` helper from actual
`.references()` constraints. Adminium reads `.references()`, because that is the
one the database knows about. A `relations()` block with no matching
`.references()` produces no relation.

## Notes

- **Multi-file schemas**: concatenate, or import the barrel — but see the static
  limit above; re-exports across modules may not resolve.
- **`sql\`…\`` defaults** import as opaque text. The default exists; Adminium
  will not evaluate it.
