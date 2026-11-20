<!-- produced from apps/docs/src/content/docs/reference/cli.md § `archive`; do not edit -->

# CLI reference: `archive`

```
adminium archive create <file> [--export] [--without-your-database]
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
| `--without-your-database` | off | `create`: leave out the connection string of the user's own database (`ADMINIUM_YOUR_DATABASE`); `restore` lists it as a draft, and the next boot fills it from the environment |
| `--project-dir <folder>` | `ADMINIUM_PROJECT_DIR` | `restore`: where the project folder goes (new or empty) |
| `--hold` | off | `restore`: public pages hidden (the operator's hold, which Studio cannot lift), mail off, the Designer off |
| `--keep-api-keys` | off | `restore`: keep the archive's API keys |
| `--drop-secrets` | off | `restore`: restore under a different `ADMINIUM_SECRET`, without the encrypted secrets |
| `--dry-run` | off | `restore`: check everything, write nothing |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

For a trial run as an operator project (`ADMINIUM_OPERATOR_PROJECT=on`), these two
commands also run with the switch and `ADMINIUM_PROJECT_DIR` but neither
`ADMINIUM_TRIAL_MODE` nor `ADMINIUM_HOSTED_MODE`, beside the stopped trial: the project
comes from the environment, and nothing in its folder is read or run. `restore` then
puts the folder at `ADMINIUM_PROJECT_DIR` (or `<ADMINIUM_DATA_DIR>/project`). Every other
command, `start` included, refuses the switch outside trial and hosted mode.

→ [Back up and move an instance](https://docs.adminium.dev/self-hosting/archive/)

---
