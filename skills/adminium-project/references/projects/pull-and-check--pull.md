<!-- produced from apps/docs/src/content/docs/projects/pull-and-check.md § Pull; do not edit -->

# Pull and check: Pull

Somebody with admin rights renames a column on the live admin. The server keeps
that edit and marks the page **changed on server** — a deploy of the older file
will not overwrite it. To get it into the project:

```bash
npm run pull -- --from https://admin.example.com
```

It writes only what changed there: the pages edited on that server, the pages
created there, and the pages it deleted (their files are removed). Then you
review it like any other change:

```bash
git diff
git commit -am "pull the label changes from the live admin"
```

Deploy, and the flags clear by themselves: once the deployed files match what
the server has, there is nothing left to pull. A page that changed on **both**
sides comes back as the server's copy, so `git diff` shows you exactly what to
merge.

`pull` never changes the server.

### The API key it needs

`--from` reads the server over its API, so it needs a key:

1. In the live admin, open **API keys** and create one. Its role must have
   *Read pages and schema changes for a project pull* — the built-in **Admin**
   and **Super Admin** roles have it. The key is shown once.
2. Put it in `.env` (or the environment) as `ADMINIUM_API_KEY=adm_sk_…`.

The key may be read-only in every other respect; this one permission is all
`pull` uses.

### Without `--from`

```bash
npm run pull
```

writes every page and schema file from the project's **own** database — the one
`npm run dev` uses. It is how [adopting an instance](https://docs.adminium.dev/projects/#from-an-instance-you-already-run)
fills the folder, and a way to start over if you have deleted files you want
back. A file the database has not seen yet is left alone; the next `dev` applies
it.
