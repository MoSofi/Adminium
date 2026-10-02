<!-- produced from apps/docs/src/content/docs/projects/apps.md § Check it; do not edit -->

# An app in your project: Check it

```bash
npx @adminiumjs/adminium app check
```

[`adminium app check`](https://docs.adminium.dev/reference/cli/#app-check) puts the manifest together and validates it
exactly as an install does. A problem names the file and the field it is in:

```
✗ apps/repairs/manifest/tables/jobs.json: columns.2.type — Invalid option: expected one of "id"|"text"|…
```

It then lists what the customer side may reach. That list comes from `access.json` alone: a table
the app has but does not grant there is out of the customers' reach, whatever the screens try.

`app check` also refuses one thing the manifest's shape allows and an install does not: a table
that anyone may add a row to may not also be one anyone may read, because every row could then be
read by guessing ids. Grant reading and adding on different tables, as the starter does with
`items` and `requests`.
