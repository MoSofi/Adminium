---
title: CLI reference
description: Every adminium command and flag — start, migrate, introspect, generate-prompt, apply-llm-response, export-zip, import-zip.
---

```
adminium [command] [options]
```

Run with **no command** to start the interactive setup wizard. That is what
`npx adminium` does.

CLI subcommands call the same services the Studio's HTTP routes call — one code
path, two front doors. A run created by `generate-prompt` is the same kind of row
the Studio creates; an introspection from the CLI is the same snapshot.

## Global options

| Flag | |
|---|---|
| `-h`, `--help` | Show help. `adminium <command> --help` for one command. |
| `-v`, `--version` | Show the version |

## Environment

| Variable | |
|---|---|
| `ADMINIUM_SECRET` | **Required.** Derives the key encrypting stored DSNs and API keys. |
| `ADMINIUM_META_URL` | Meta store DSN (`postgres://`, `mysql://`, `sqlite:<path>`) |
| `ADMINIUM_DATA_DIR` | Writable data directory (default `./data`) |
| `PORT`, `HOST` | Listen address (default `4600`, `0.0.0.0`) |

**Flags override the environment.** Full list:
[Environment variables](/self-hosting/env-vars/).

## Exit codes

| Code | |
|---|---|
| `0` | Success |
| `1` | Error — usage, unreachable database, missing file, bad configuration |
| `2` | `apply-llm-response`: validation failed |
| `3` | `apply-llm-response`: nothing accepted |

`2` and `3` are a published contract, meaningful only for
[`apply-llm-response`](#apply-llm-response). Everything else uses `0` / `1`.

---

## `init`

```
adminium [init] [--port <n>] [--host <addr>]
```

Walks through connecting a database and generating an admin app, then starts the
server. This is what `npx adminium` runs with no arguments.

| Flag | Default | |
|---|---|---|
| `-p`, `--port <n>` | `PORT` or 4600 | Port to listen on |
| `--host <addr>` | `HOST` or 0.0.0.0 | Address to bind |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN (skips the meta question) |
| `--name <name>` | prompted | Connection name |

Requires an interactive terminal. Non-interactive? Configure via the environment
and run [`start`](#start).

---

## `start`

```
adminium start [--port <n>] [--host <addr>]
```

Boots Adminium against the configured meta store, applying any pending
migrations first. With nothing configured it falls back to an embedded SQLite
meta store under the data directory and says so.

| Flag | Default | |
|---|---|---|
| `-p`, `--port <n>` | `PORT` or 4600 | Port to listen on |
| `--host <addr>` | `HOST` or 0.0.0.0 | Address to bind |
| `--meta-url <dsn>` | `ADMINIUM_META_URL`, else embedded SQLite | Meta store DSN |
| `--data-dir <path>` | `ADMINIUM_DATA_DIR` or `./data` | Data directory |
| `--log-level <level>` | `ADMINIUM_LOG_LEVEL` or `info` | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace` |
| `--skip-migrate` | off | Do not apply pending meta migrations on boot |

```bash
adminium start --port 8080 --host 127.0.0.1 --log-level debug
```

---

## `migrate`

```
adminium migrate [--status]
```

Applies any pending `adminium_*` migrations to the meta store, in order. Safe to
re-run: already-applied migrations are skipped via the ledger. `start` and the
setup wizard run this for you; call it directly when you upgrade Adminium in a
deployment that boots against a pre-migrated store.

| Flag | |
|---|---|
| `--status` | List migrations and whether each is applied; apply nothing |
| `--meta-url <dsn>` | Meta store DSN |
| `--data-dir <path>` | Data directory |

```bash
adminium migrate --status
```

```
migration                 applied  note
0001_init                 yes
0007_add_widget_layouts   no
```

The `note` column carries `CHECKSUM DRIFT` (an applied migration no longer
matches this version) or `unknown to this version` (the store was written by a
newer Adminium — you downgraded). Both are alarms:
[Upgrading](/self-hosting/upgrades/).

---

## `introspect`

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

The `--out` file is [JSON IR](/guides/schema-import/json-ir/), so it re-imports.

---

## `generate-prompt`

```
adminium generate-prompt --connection <id> [--sections <list>] [--locales <list>]
                        [--sampling] [--out <file>]
```

Creates a BYO run from the connection's latest snapshot and writes the prompt.
Paste it into any chat model, save the reply, and feed it back with
[`apply-llm-response`](#apply-llm-response).

Nothing leaves this machine: BYO runs record no provider and no model, and the
prompt carries schema metadata + aggregates only — never your rows, unless you
opt in with `--sampling`.

| Flag | Default | |
|---|---|---|
| `-c`, `--connection <id>` | **required** | Connection id to build the prompt for |
| `--sections <list>` | all sections | Decision groups to request, e.g. `labels,enums,relations` |
| `--locales <list>` | `en_US` | Output locales, e.g. `en_US,de_DE` (`en_US` is always included) |
| `--sampling` | off — sample-free | Opt in to including sampled example values in the prompt |
| `-o`, `--out <file>` | print to stdout | Write the prompt here (chunked runs get `<name>.<n>.<ext>`) |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

Prints the `runId` and a token estimate.
→ [BYO round-trip](/guides/llm-assist/byo-prompt/)

---

## `apply-llm-response`

```
adminium apply-llm-response --run <runId> --file <response.json>
                           [--chunk <n>] [--yes-above <0..1>] [--dry-run]
```

Feeds a saved model reply back into its run: validates it, prints the diff
against the heuristic baseline, and applies the rows at or above the confidence
threshold in one transaction.

Your own edits are never overwritten (`user > llm > heuristic`), and applying the
same run twice writes no duplicates.

| Flag | Default | |
|---|---|---|
| `-r`, `--run <runId>` | **required** | Run id from `generate-prompt` |
| `-f`, `--file <path>` | **required** | The saved model response |
| `--chunk <n>` | unchunked | Which chunk this file answers, for chunked runs |
| `--yes-above <0..1>` | `0.8` | Accept suggestions at or above this confidence |
| `--dry-run` | off | Validate and print the diff; write nothing |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

**Exit codes: `0` applied · `2` validation failed · `3` nothing accepted.**

→ [BYO round-trip](/guides/llm-assist/byo-prompt/)

---

## `export-zip`

```
adminium export-zip [--connection <id>] [--out <file>] [--include-secrets]
```

Bundles the server plus its configuration — connections, snapshots, overrides,
pages and dashboards, views, settings, roles — so it can be restored or replayed
elsewhere.

:::caution[Configuration, not source code]
Adminium interprets configuration at runtime and does not emit a generated app.
There is no source in this bundle. See [Export & restore](/self-hosting/export-zip/).
:::

| Flag | Default | |
|---|---|---|
| `-c`, `--connection <id>` | the whole instance | Export only this connection |
| `-o`, `--out <file>` | `./adminium-export.zip` | Destination archive path |
| `--include-secrets` | off | Include encrypted DSNs and provider keys in the bundle |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

→ [Export & restore](/self-hosting/export-zip/)

---

## `import-zip`

```
adminium import-zip --in <file> [--dry-run]
```

Restores a bundle produced by [`export-zip`](#export-zip) — the other half of the
same flow. The meta-store migrations run first, then every config document is
replayed forward to the version this build understands, so a bundle exported by
an older Adminium imports cleanly.

Resources are matched on natural keys rather than raw ids, so a re-import updates
what is already there instead of duplicating it. Everything happens in one
transaction: a bundle that fails halfway leaves no half-restored instance behind.

| Flag | Default | |
|---|---|---|
| `-i`, `--in <file>` | **required** | Bundle to import |
| `--dry-run` | off | Validate and report; write nothing |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

Trial a restore before committing to it:

```bash
adminium import-zip --in adminium-export.zip --dry-run
```

That reads the archive, checks the manifest, replays and validates every config
document, and prints what *would* be written — without touching the database.

:::note[A bundle from a newer Adminium is refused]
Not partially read. A build that does not understand a document's version would
silently drop the parts it cannot see, and a silent partial restore is worse than
a failed one. Upgrade this instance instead.
:::

If the bundle was exported without `--include-secrets` (the default), connections
that are **new** to this instance import without credentials and need their
connection string entered once. Connections already configured here keep the
credentials they have — a no-secrets bundle has nothing to replace them with, so
it does not try.

→ [Export & restore](/self-hosting/export-zip/)
