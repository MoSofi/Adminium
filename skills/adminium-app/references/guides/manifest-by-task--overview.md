<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md; do not edit -->

# A manifest, task by task

This page is for someone building an app in a project's `apps/<key>/` folder
([An app in your project](https://docs.adminium.dev/projects/apps/)). Each section is one task: the part file it goes in, a
small example, and the mistakes the check most often refuses. The
[manifest spec](https://docs.adminium.dev/reference/manifest/) has every field; each section links to its part of it.

The examples are one app, `repairs`. After every change, run:

```bash
npx @adminiumjs/adminium app check
```

`app.json` is the app itself. The other sections add files beside it.

```json title="manifest/app.json"
{
  "manifestVersion": 1,
  "key": "repairs", "name": "Repairs", "version": "0.1.0",
  "publisher": { "id": "local", "name": "Local" },
  "license": "UNLICENSED", "categories": ["operations"],
  "description": { "key": "repairs.description", "fallback": "Repairs, made with Adminium." },
  "compatibility": { "minAdminiumVersion": "0.3.18" },
  "frontends": [{ "side": "customer", "kind": "spa" }],
  "navGroups": [{ "key": "main", "label": { "en-US": "Repairs" }, "order": 1 }],
  "prefixed": true
}
```

`publisher` is `local` for an app made in your own project, `key` is the folder's name, and
`categories` is one or more of `commerce`, `hospitality`, `operations`, `crm`, `internal-tools`.

Two rules hold everywhere. Every object is strict: a field the spec does not list is an error. And
a table or page file is named after its `ref`: `tables/jobs.json` holds `"ref": "jobs"`.
