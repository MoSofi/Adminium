<!-- produced from apps/docs/src/content/docs/projects/apps.md § Start one; do not edit -->

# An app in your project: Start one

```bash
npx @adminiumjs/adminium app new repairs --staff --customer
```

[`adminium app new`](https://docs.adminium.dev/reference/cli/#app-new) writes a small working app: two tables (`items`, and
`requests` for what customers send in), a dashboard page for each, one role, six sample rows, a
README and a test file. `--staff` and `--customer` each add a side with one screen; leave both out
for an app that is its tables and pages alone. Everything it writes is
yours to edit, and nothing is generated again later.
