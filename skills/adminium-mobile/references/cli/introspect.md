<!-- produced from apps/docs/src/content/docs/reference/cli.md § `introspect`; do not edit -->

# CLI reference: `introspect`

```
adminium introspect --connection <id> [--out <file>]
```

Reads the source database schema — never its rows — classifies it, and stores a
snapshot. Re-running with an unchanged schema is a no-op: the checksum matches
and no new snapshot is written.

| Flag | Default | |
|---|---|---|
| `-c`, `--connection <id>` | **required** | Connection id to introspect |
| `-o`, `--out <file>` | | Also write the snapshot schema to this JSON file |
| `--timeout <ms>` | `30000` | Introspection budget in milliseconds |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

```bash
adminium introspect --connection prod-db --out schema.json
```

```
Snapshot snp_01HQ8 stored — 24 tables, checksum a3f2c1d90e4b.
Proposed 7 PII mask override(s) — masking is on by default.
Wrote /work/schema.json
```

The `--out` file is [JSON IR](https://docs.adminium.dev/guides/schema-import/json-ir/), so it re-imports.

---
