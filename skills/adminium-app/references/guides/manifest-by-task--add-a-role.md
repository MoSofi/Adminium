<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Add a role; do not edit -->

# A manifest, task by task: Add a role

`roles.json` is the array of roles the app brings. Each is installed as `<app key>-<role key>`
(`repairs-staff`).

```json title="manifest/roles.json"
[
  { "key": "staff", "name": "Repairs staff", "permissions": [
      "table:@customers:read", "table:@customers:create", "table:@customers:update",
      "table:@jobs:read", "table:@jobs:create", "table:@jobs:update",
      "table:@requests:read", "table:@requests:update", "page:@repairs-jobs:view" ] },
  { "key": "manager", "name": "Repairs manager", "cloneFrom": "staff", "permissions": ["table:@jobs:delete"] }
]
```

The `@` stands for "this app's": a manifest cannot know the real table names or page ids, so it
writes the short ref after `@` and the install fills in the rest.

| Grant | Actions |
|---|---|
| `table:@<table ref>:<action>` | `read`, `create`, `update`, `delete`, `export`, `import`, `read_pii` |
| `page:@<page ref>:<action>` | `view`, `edit` |
| `app:@:staff` | Open the app's staff screens. |

- **Pages are granted one by one.** A role without `page:@<page ref>:view` does not see that page
  in the sidebar, whatever it may do with the table.
- **Personal data is masked without `read_pii`.** A column that holds a person's name, phone,
  email or address reads as empty to a role that lacks `table:@<table ref>:read_pii` on the table
  the value lives in. A front desk that rings customers needs it. See
  [Personal data](https://docs.adminium.dev/guides/apps/roles-and-staff-access/#personal-data).
- A role may never grant a `system:` permission, a wildcard (`*`), or a table or page the app
  does not declare. `cloneFrom` names another role of the same app.
- These are refused when the app is installed, not by the manifest check, so run
  `npx @adminiumjs/adminium app try` after changing roles.
- `<app key>-<role key>` must fit in 40 characters.

Reference: [Roles](https://docs.adminium.dev/reference/manifest/#roles),
[App roles and staff access](https://docs.adminium.dev/guides/apps/roles-and-staff-access/).
