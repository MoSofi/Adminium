<!-- produced from apps/docs/src/content/docs/projects/index.md § One command; do not edit -->

# Create a project: One command

```bash
npx @adminiumjs/adminium new my-admin
```

It asks which database the admin should be built from:

```
Which database should the admin be built from?
  › The sample database     a small demo company, in SQLite
    My own database         a Postgres, MySQL or SQLite URL
    Decide later            set DATABASE_URL in .env
```

Then it writes the folder, puts a fresh `ADMINIUM_SECRET` and your database URL
in `.env`, starts a git repository, and installs the dependencies with the
package manager you ran it with:

```
Created my-admin.
  Added:       package.json, adminium.config.ts, tsconfig.json, .env.example, …
  Wrote:       .env (ADMINIUM_SECRET), .env (DATABASE_URL)

Next:
  cd my-admin
  npm run dev
```

`--sample`, `--database <url>` and `--yes` answer the questions up front, which
is what you want in a script:

```bash
npx @adminiumjs/adminium new my-admin --sample --yes
```

Every flag: [`adminium new`](https://docs.adminium.dev/reference/cli/#new).
