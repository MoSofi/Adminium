<!-- produced from apps/docs/src/content/docs/reference/cli.md § `start`; do not edit -->

# CLI reference: `start`

```
adminium start [--port <n>] [--host <addr>]
```

Boots Adminium against the configured meta store, applying any pending
migrations first. With nothing configured it falls back to an embedded SQLite
meta store under the data directory and says so.

Inside a project, `start` also:

- loads the project's `.env`, where a variable already set in the environment
  wins;
- loads the config from `.adminium/build/`. When that build is missing, out of
  date, or made by another Adminium version, it builds first. Without esbuild,
  a TypeScript config stops there and asks for `npm run build`;
- keeps its data in the project's `data/` folder, unless the config's `dataDir`,
  `ADMINIUM_DATA_DIR` or `--data-dir` says otherwise;
- connects the databases the config lists, and ignores `ADMINIUM_SOURCE_URL`;
- applies the [project files](https://docs.adminium.dev/reference/cli/#project-files). A file changed since the last
  start is applied, unless its page was also changed on this server. That page
  keeps the server's version, and Studio → Pages marks it until you
  [`pull`](https://docs.adminium.dev/reference/cli/#pull) it and deploy. Studio also offers to keep the server copy or
  use the project's. A file with a mistake is not applied, and the log says why;
- loads the project's [hooks and actions](https://docs.adminium.dev/projects/hooks-and-actions/)
  from the build before it accepts requests. A file that does not load is
  skipped and listed in Studio → Settings → Project.

The project is the nearest folder, from the current one upwards, that holds
`adminium.config.ts`, or the folder `ADMINIUM_PROJECT_DIR` names.

| Flag | Default | |
|---|---|---|
| `-p`, `--port <n>` | `PORT` or 4600 | Port to listen on |
| `--host <addr>` | `HOST` or 0.0.0.0 | Address to bind |
| `--meta-url <dsn>` | `ADMINIUM_META_URL`, else embedded SQLite | Meta store DSN |
| `--data-dir <path>` | `ADMINIUM_DATA_DIR`, else `./data` inside a project or `~/.adminium` | Data directory |
| `--log-level <level>` | `ADMINIUM_LOG_LEVEL` or `info` | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace` |
| `--static-root <path>` | `ADMINIUM_STATIC_ROOT`, else the bundled build | Serve the dashboard build from this directory |
| `--skip-migrate` | off | Do not apply pending meta migrations on boot |

```bash
adminium start --port 8080 --host 127.0.0.1 --log-level debug
```

---
