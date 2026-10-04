<!-- produced from apps/docs/src/content/docs/projects/pull-and-check.md § Check; do not edit -->

# Pull and check: Check

```bash
npm run check
```

```
✓ adminium.config.ts is valid
✓ the settings the server starts with are valid
✓ database "main" has a usable URL
✓ 20 page file(s), 1 schema file(s) and 2 list file(s) are valid
✓ 2 hook(s) and 1 action(s) load
✓ the Dockerfile builds on @adminiumjs/adminium 0.3.16, the version package.json installs
```

It checks, without connecting to anything:

- `adminium.config.ts` loads and is valid, and the settings a server would
  start with are valid;
- every database URL parses;
- every page, schema and list file is valid, names only databases the config
  lists, and holds no id from one install — including that every rule naming
  an option list names one this project carries, or a built-in;
- `.adminium/build` was made by this Adminium version;
- every hook and action loads and names a database the config lists;
- your pages and widgets build, and every widget a page file names exists and
  is of the right kind — a cell on a table column, a card on a dashboard;
- the `Dockerfile`'s image tag equals the Adminium version `package.json`
  installs.

It exits **2** when something is wrong, naming the file and the field. A missing
`ADMINIUM_SECRET` or an unset database URL is only a warning, because CI usually
has neither:

```
! ADMINIUM_SECRET is not set; `adminium start` needs it (put it in .env).
! database "main" has no URL yet; set it in .env.
```

### In CI

```yaml title=".github/workflows/check.yml"
name: check
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check
```

No database, no secret, no services. `npm ci` is needed because `check` builds
the config and your code with the project's own `esbuild`.
