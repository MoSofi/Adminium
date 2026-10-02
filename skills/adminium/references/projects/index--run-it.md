<!-- produced from apps/docs/src/content/docs/projects/index.md § Run it; do not edit -->

# Create a project: Run it

```bash
cd my-admin
npm run dev
```

Open `http://localhost:4600` and create the first super admin. On this first
run Adminium connects the database, reads its schema, generates the pages — and
writes them into your folder:

```
Database "main": added (postgres://…).
Database "main": generated 20 page(s).
Wrote schema/main.json.
Wrote pages/contacts.json.
Wrote pages/orders.json.
…
```

From here the folder and the running admin stay in step in both directions: edit
`pages/orders.json` and the open page changes; rename a column in Studio and the
file changes. That is [page files](https://docs.adminium.dev/projects/page-files/).

`npm run dev` restarts when `adminium.config.ts` or `.env` changes, and reloads
your [hooks, actions](https://docs.adminium.dev/projects/hooks-and-actions/),
[pages and widgets](https://docs.adminium.dev/projects/pages-and-widgets/) without a restart. Ctrl-C
stops it.
