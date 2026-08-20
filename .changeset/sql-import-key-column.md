---
'@adminium/schema-import': patch
---

Keep a column named `key`, and detect the two `CREATE TABLE` spellings the probe could not see.

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
