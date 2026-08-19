---
'@adminium/schema-import': patch
'@adminium/adapter-postgres': patch
'@adminium/adapter-sqlite': patch
---

Recover schemas that four import paths were silently losing.

- TypeORM: every entity declared with the documented `@Entity({ name: '...' })`
  object form was dropped, and a file using only that form failed outright with
  "no @Entity classes found in input". The decorator scan ended its search at the
  last `}`, which is the options object's own closing brace.
- SQL: MySQL makes the constraint symbol optional, so `CONSTRAINT FOREIGN KEY
  (a) REFERENCES b(id)` parsed `FOREIGN` as the symbol and produced an index
  named `FOREIGN` instead of a relation.
- SQL: `bit varying` / `varbit` mapped to `unknown` despite the parser building
  that two-word spelling exactly as it does `character varying`.
- Postgres: `CREATE TYPE x AS ENUM ()` is legal, and the empty enum failed IR
  validation — one of them anywhere made the whole database un-introspectable.
  Valueless enums are now dropped with an `enum-empty` warning.
- SQLite: CHECK-to-enum synthesis compared column names case-sensitively against
  case-insensitive identifiers, so `status TEXT CHECK (STATUS IN (...))`
  synthesized no enum and the column rendered as free text.
