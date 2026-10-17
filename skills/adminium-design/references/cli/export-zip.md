<!-- produced from apps/docs/src/content/docs/reference/cli.md § `export-zip`; do not edit -->

# CLI reference: `export-zip`

```
adminium export-zip [--connection <id>] [--out <file>] [--include-secrets]
```

Bundles the server plus its configuration — connections, snapshots, overrides,
pages and dashboards, views, settings, roles — so it can be restored or replayed
elsewhere.

> **Caution: Configuration, not source code**
> Adminium interprets configuration at runtime and does not emit a generated app.
> There is no source in this bundle. See [Export & restore](https://docs.adminium.dev/self-hosting/export-zip/).

| Flag | Default | |
|---|---|---|
| `-c`, `--connection <id>` | the whole instance | Export only this connection |
| `-o`, `--out <file>` | `./adminium-export.zip` | Destination archive path |
| `--include-secrets` | off | Include encrypted DSNs and provider keys in the bundle |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

→ [Export & restore](https://docs.adminium.dev/self-hosting/export-zip/)

---
