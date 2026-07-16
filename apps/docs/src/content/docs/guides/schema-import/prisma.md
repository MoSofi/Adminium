---
title: Import a Prisma schema
description: Import schema.prisma. Models, relations, enums, and the attributes that map back to real column names.
---

## The file

Point Adminium at `prisma/schema.prisma`. That one file is the whole schema.

## Detection

Adminium detects Prisma by `datasource`, `generator client`, or `model` blocks.

## What is read

| Prisma | Becomes |
|---|---|
| `model` | table |
| Scalar fields | columns, typed via the mapping table |
| `@id`, `@@id` | primary key |
| `@relation` | foreign key + navigable relation |
| `enum` | enum field → select input |
| `@unique`, `@@unique` | unique constraint |
| `@@index` | index |
| `@default(…)` | column default |
| `?` | nullable |
| `@map`, `@@map` | **the real column/table name** |
| `///` doc comments | field descriptions |

## `@map` is why you use the Prisma importer

```prisma
model User {
  id        Int      @id @default(autoincrement())
  emailAddr String   @unique @map("email_address")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("users")
}
```

Prisma's client says `User.emailAddr`; the database column is `email_address`
and the table is `users`. Adminium imports the **database** names, because those
are what it will query — while using the Prisma names as labels, since those are
what your team says out loud.

Import that model as raw SQL and you would get the same columns. Import it as
Prisma and you also get the vocabulary.

## Notes

- **`@relation` without a foreign key.** Prisma can model relations the database
  does not enforce (implicit many-to-many, `relationMode = "prisma"`). Adminium
  imports the relation as declared. If your database has no constraint,
  Adminium's navigation still works but nothing enforces integrity underneath.
- **Implicit many-to-many** creates a join table Prisma manages and never names
  in the schema. Adminium infers it from the relation, following Prisma's
  `_ModelAToModelB` convention.
- **`Unsupported("…")`** imports as text with a warning. Prisma could not type
  it either.
- **Multi-file schemas** (`prismaSchemaFolder`): concatenate them, or import the
  one with your models.
