<!-- produced from apps/docs/src/content/docs/projects/folder.md § Several databases; do not edit -->

# The project folder: Several databases

Each key under `databases` is one connection, and the key is the name your
files use:

```ts
export default defineConfig({
  databases: {
    main: { url: env('DATABASE_URL') },
    billing: { url: env('BILLING_DATABASE_URL') },
  },
});
```

A key is lowercase letters, digits and `-`, starting with a letter. Files then
say `"database": "main"` rather than a connection id, which is why the same
files work on your laptop and on a server.

| What you do | What happens |
|---|---|
| Add a key | The next start connects it, reads its schema and generates its pages. A database that already has page files is only read: its pages come from the files. |
| Change its URL | The stored connection string is updated, still encrypted. |
| Leave the URL empty | The project starts without it: *Database "billing" has no URL yet. Set it in .env (or the environment) and restart.* |
| A URL that does not answer | The connection is kept in an error state and the boot continues; the next start tries again. |
| Remove a key | Nothing is deleted. Every start says the connection is no longer in the project config, and you remove it in Studio if you meant to. |
| Add a database in Studio | It has no key, so its pages stay in Adminium's database only, and Studio says so. Add it to `adminium.config.ts` to keep its pages in the project. |
