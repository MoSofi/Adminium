<!-- produced from apps/docs/src/content/docs/projects/folder.md § `.env`; do not edit -->

# The project folder: `.env`

`new` writes two values:

```bash title=".env"
ADMINIUM_SECRET=…
DATABASE_URL=postgres://user:password@localhost:5432/shop
```

`ADMINIUM_SECRET` derives the key that encrypts every stored connection string
and API key. Keep a copy somewhere safe and never change it: without it, those
values cannot be decrypted. Each server keeps its own.

`dev`, `start`, `build`, `check` and `pull` all read `.env` from the project
root. A variable already set in the environment wins, and an empty value counts
as unset. `.env` is gitignored; `.env.example` is committed, so whoever clones
the repo knows which keys to fill in.
