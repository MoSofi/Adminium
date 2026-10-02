<!-- produced from apps/docs/src/content/docs/projects/index.md § From an instance you already run; do not edit -->

# Create a project: From an instance you already run

If you have been using Adminium without a project, `new` adopts it rather than
starting over. A `data/` folder holding an instance is kept as it is, and
`--import` copies one in first — `~/.adminium` is where
[`try`](https://docs.adminium.dev/projects/#try-it-without-a-project) puts an instance started from a folder of its
own:

```bash
mkdir my-admin && cd my-admin
npx @adminiumjs/adminium new --import ~/.adminium
```

What happens:

- **The secret is kept.** `new` takes `ADMINIUM_SECRET` from `.env` or the
  environment, or asks for it, and checks that it opens the instance's stored
  connection strings before it writes anything. Without the right secret it
  stops.
- **Each connection gets a key.** The oldest becomes `main`, the others are
  named after the connection. `adminium.config.ts` lists them, each reading its
  URL from `.env` (`DATABASE_URL`, then `<KEY>_DATABASE_URL`).
- **Those variables start empty.** The URLs stay where they are, encrypted, in
  the instance; `new` never writes a password into a file. Fill them in when you
  want the config to be the source.
- **Its pages and schema customizations are written** to `pages/` and
  `schema/`, so what you already built is in the folder from the first commit.

Users, roles, settings, saved views and the audit log stay in the instance's
own database, as they do in every project.
