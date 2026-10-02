<!-- produced from apps/docs/src/content/docs/reference/cli.md § `check`; do not edit -->

# CLI reference: `check`

```
adminium check
```

Checks a project without starting it, for CI:

- `adminium.config.ts` loads and is valid (it is built first when the build is
  out of date);
- the settings the server would start with are valid;
- every database URL parses;
- every [project file](https://docs.adminium.dev/reference/cli/#project-files) is valid, names only databases the
  config lists, and holds no id from one install;
- `.adminium/build` was made by this Adminium version;
- every built hook and action loads, is valid, and names a database the config
  lists;
- the pages and widgets written in React build, and every page file that names
  a project widget names one that exists, of the right kind: a `cell` widget
  on a table column, a `card` widget on a dashboard;
- the Dockerfile's image tag equals the Adminium version `package.json` installs.

Exits `2` when something is wrong, naming the file and field of a broken
project file. It needs no database. A missing `ADMINIUM_SECRET` is only a
warning, since CI usually does not have it.

→ [Pull and check](https://docs.adminium.dev/projects/pull-and-check/#check), with a GitHub Actions
workflow

---
