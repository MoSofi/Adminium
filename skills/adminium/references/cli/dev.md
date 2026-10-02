<!-- produced from apps/docs/src/content/docs/reference/cli.md § `dev`; do not edit -->

# CLI reference: `dev`

```
adminium dev [--port <n>] [--host <addr>]
```

Runs the project: it builds, then runs [`start`](https://docs.adminium.dev/reference/cli/#start) for it. When
`adminium.config.ts`, a file it imports, or `.env` changes, it builds again and
restarts the server. A failed build or a crash does not end it; it waits for
the next change. Stop it with Ctrl-C.

A change to a file in `hooks/` or `actions/`, or to a file one of them
imports, rebuilds only those and swaps them into the running server without a
restart. If they no longer build, the server keeps the ones it has.

A change to a page or widget written in React (`pages/*.tsx`, `widgets/*.tsx`,
or a file they import) rebuilds the browser code, and open dashboards load the
new files and draw them again. A page's state starts over.

The [project files](https://docs.adminium.dev/reference/cli/#project-files) are the master copy while it runs:

- a saved page or schema file is applied at once, and open dashboards reload;
- an edit made in Studio, or by a command such as `apply-llm-response`, is
  written to its file, and a page created or deleted in Studio creates or
  deletes its file;
- deleting a file deletes its page;
- when a file and the database both changed, the file wins, and `dev` says so;
- a file with a mistake is not applied. `dev` names the file and the field, and
  the page keeps its last good version.

The first run of a new project generates pages from its databases and writes
their files. A database that already has page files is only read, and its
pages come from the files.

| Flag | Default | |
|---|---|---|
| `-p`, `--port <n>` | `PORT` or 4600 | Port to listen on |
| `--host <addr>` | `HOST` or 0.0.0.0 | Address to bind |
| `--log-level <level>` | `ADMINIUM_LOG_LEVEL` or info | Server log level |

---
