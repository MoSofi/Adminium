<!-- produced from apps/docs/src/content/docs/reference/cli.md § `try`; do not edit -->

# CLI reference: `try`

```
adminium try [--browser|--terminal] [--port <n>] [--host <addr>]
```

Tries Adminium without a project: walks through connecting a database and
generating an admin app, then starts the server. Its data goes to `./data`
beside a project of another kind, or to `~/.adminium`. `adminium init` is the
same command. It refuses to run inside an Adminium project.

| Flag | Default | |
|---|---|---|
| `--browser`, `--terminal` | asked | Where to continue the setup |
| `--no-open` | | Do not launch a browser; just print the URL |
| `--bridge` | off | Let [adminium.dev](https://adminium.dev/generate/) hand this instance a connection string, for the length of this run. It prints a pairing code the hand-off needs. See [`ADMINIUM_BRIDGE_ORIGINS`](https://docs.adminium.dev/self-hosting/env-vars/#adminium_bridge_origins). |
| `--log-level <level>` | `ADMINIUM_LOG_LEVEL`, else warn | Server log level once it starts |
| `-p`, `--port <n>` | `PORT` or 4600 | Port to listen on |
| `--host <addr>` | `HOST` or 0.0.0.0 | Address to bind |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN (skips the meta question) |
| `--name <name>` | prompted | Connection name |

Requires an interactive terminal. Non-interactive? Configure via the environment
and run [`start`](https://docs.adminium.dev/reference/cli/#start).

---
