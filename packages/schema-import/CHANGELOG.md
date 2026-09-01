# @adminium/schema-import

## 0.2.4

### Patch Changes

- @adminium/engine@0.2.4

## 0.2.3

### Patch Changes

- Updated dependencies [ac3f5e7]
  - @adminium/engine@0.2.3

## 0.2.2

### Patch Changes

- e52d7da: Recover schemas that four import paths were silently losing.
  
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
- 08df45d: Publish the IR JSON Schema the import guide has always pointed at, and accept the
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
- 81394c0: Keep a column named `key`, and detect the two `CREATE TABLE` spellings the probe could not see.
  
  Two more paths that returned less than was pasted, both found while writing
  coverage for the four fixed in `introspection-and-parser-fixes`:
  
  - **A column named `key` was parsed as a table constraint.** `CREATE TABLE kv
    (key TEXT PRIMARY KEY, value TEXT)` lost the `key` column entirely, and if
    nothing else survived the table was dropped as empty. `key` is half of every
    key/value table and is not reserved in SQLite or Postgres. The head word is no
    longer decisive: `KEY idx_kv (val)` and `key VARCHAR(255)` are the same three
    tokens, so the parser now looks at the second word — a type name means a
    column, another constraint word means a constraint, and anything else falls
    back to the structural test that a table constraint always ends in a
    parenthesised column list. Same lookahead on `ALTER TABLE … ADD`. `check`,
    `index`, `unique`, `primary` and `spatial` were losable the same way.
  - **The SQL format probe missed `CREATE UNLOGGED TABLE` and `CREATE TEMPORARY
    TABLE`.** The parser has always skipped that qualifier list; only detection
    could not see past `/CREATE\s+TABLE/`, so such a file was undetectable and had
    to be imported by naming the format by hand. The widened pattern uses a
    BOUNDED repetition — the obvious `(?:\w+\s+)*TABLE` is the polynomial shape
    this package already carries CodeQL scars for — and `test/redos.test.ts` pins
    it linear at 160 KB of adversarial input.
- Updated dependencies [2dffc12]
- Updated dependencies [08df45d]
- Updated dependencies [2684976]
- Updated dependencies [ef1c300]
  - @adminium/engine@0.2.2

## 0.2.2-rc.0

### Patch Changes

- Updated dependencies [2684976]
- Updated dependencies [ef1c300]
  - @adminium/engine@0.2.2-rc.0

## 0.2.1

### Patch Changes

- @adminium/engine@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
  - @adminium/engine@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

### Patch Changes

- Updated dependencies
  - @adminium/engine@0.1.0
