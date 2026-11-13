<!-- produced from apps/docs/src/content/docs/reference/cli.md § `archive`; do not edit -->

# CLI reference: `archive`

```
adminium archive create <file> [--export]
adminium archive restore <file> [--project-dir <folder>] [--hold] [--keep-api-keys] [--drop-secrets] [--dry-run]
```

A whole instance in one file: the meta store (from any engine, restorable into
any), uploads kept on this server, local SQLite databases, the project folder
and the list of installed catalog apps and add-ons. `restore` puts it back into a
**fresh** instance only: an empty data dir and meta database, before the first
start.

| Flag | Default | |
|---|---|---|
| `--export` | off | `create`: leave out password hashes, secrets, keys and tokens; the file is read back by [`import-zip`](https://docs.adminium.dev/reference/cli/#import-zip) |
| `--project-dir <folder>` | `ADMINIUM_PROJECT_DIR` | `restore`: where the project folder goes (new or empty) |
| `--hold` | off | `restore`: public pages hidden (the operator's hold, which Studio cannot lift), mail off, the Designer off |
| `--keep-api-keys` | off | `restore`: keep the archive's API keys |
| `--drop-secrets` | off | `restore`: restore under a different `ADMINIUM_SECRET`, without the encrypted secrets |
| `--dry-run` | off | `restore`: check everything, write nothing |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

→ [Back up and move an instance](https://docs.adminium.dev/self-hosting/archive/)
