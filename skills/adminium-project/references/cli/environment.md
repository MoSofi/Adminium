<!-- produced from apps/docs/src/content/docs/reference/cli.md § Environment; do not edit -->

# CLI reference: Environment

| Variable | |
|---|---|
| `ADMINIUM_SECRET` | **Required.** Derives the key encrypting stored DSNs and API keys. |
| `ADMINIUM_META_URL` | Meta store DSN (`postgres://`, `mysql://`, `sqlite:<path>`) |
| `ADMINIUM_DATA_DIR` | Writable data directory (default `./data` inside a project, else `~/.adminium`) |
| `PORT`, `HOST` | Listen address (default `4600`, `0.0.0.0`) |
| `ADMINIUM_PROJECT_DIR` | The project folder, for a command run from outside it. It must hold `adminium.config.ts`. The project's Dockerfile sets it. |
| `ADMINIUM_API_KEY` | The API key [`pull --from`](https://docs.adminium.dev/reference/cli/#pull) reads a server with |

**Flags override the environment.** Full list:
[Environment variables](https://docs.adminium.dev/self-hosting/env-vars/).
