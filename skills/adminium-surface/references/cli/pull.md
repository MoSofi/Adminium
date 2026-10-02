<!-- produced from apps/docs/src/content/docs/reference/cli.md § `pull`; do not edit -->

# CLI reference: `pull`

```
adminium pull [--from <url>]
```

Writes the project's [page and schema files](https://docs.adminium.dev/reference/cli/#project-files).

Without `--from`, from the project's own database: every page and schema file
is written, and the file of a page that no longer exists is deleted. A file the
database has not seen yet is kept; the next `dev` applies it.

With `--from`, from a server running the project: it asks that server for the
pages changed there (`GET /api/v1/project/export`) and writes only those files,
deleting the file of a page deleted there. It reads `ADMINIUM_API_KEY` from
`.env` or the environment: an API key whose role has *Read pages and schema
changes for a project pull* (the built-in Admin role has it). The server is not
changed. Its notes about changed pages clear once the pulled files are
deployed to it.

```bash
npm run pull -- --from https://admin.example.com
```

A page changed both on the server and in your folder comes back as the
server's copy; `git diff` shows what to merge. Neither form changes a page.

| Flag | Default | |
|---|---|---|
| `--from <url>` | | A server running this project |

→ [Pull and check](https://docs.adminium.dev/projects/pull-and-check/)

---
