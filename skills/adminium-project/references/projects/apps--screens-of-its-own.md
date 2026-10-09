<!-- produced from apps/docs/src/content/docs/projects/apps.md § Screens of its own; do not edit -->

# An app in your project: Screens of its own

A side is a small browser app in `apps/<key>/staff/` or `apps/<key>/customer/`:

```
apps/repairs/staff/
├── src/main.tsx        where it starts
├── src/…               everything it imports, CSS and images included
├── nav.json            its screens, for the dashboard's sidebar (optional)
└── public/             files served as they are (optional)
```

The manifest declares each side in `frontends`, with `"kind": "spa"`; `app check` refuses a side
that is declared and has no code, and code that is not declared.

```bash
npx @adminiumjs/adminium app build
```

Under `adminium dev` the sides are built for you on every save. [`adminium app build`](https://docs.adminium.dev/reference/cli/#app-build) bundles each side with the project's `esbuild`
into `.adminium/build/apps/<key>/<side>/`, which is exactly the folder Adminium serves at
`/apps/<key>/<side>/`. The page it writes carries no inline script, and every asset is addressed
under that mount, so a screen opened at a deep address still finds its files. React comes from the
project's own dependencies.

`nav.json` lists the screens a staff side offers the dashboard's sidebar:

```json
[
  { "id": "jobs", "path": "", "label": "Jobs", "icon": "wrench" },
  { "id": "done", "path": "done", "label": "Done" }
]
```

A `path` never starts with `/`: it is added to wherever the side is opened. `icon` is a
[Lucide](https://lucide.dev) icon name.

Each page of a side has an address of its own, and a `path` in `nav.json` is one of them without
its first slash. A screen reads its page with `usePath()` and moves with `<Link to="/done">` or
`go('/done')`, all from `@adminiumjs/adminium/side`; the starter screens are two pages each. See
[Pages and their addresses](https://docs.adminium.dev/guides/apps/building-a-side/#pages-and-their-addresses).

### What a side is given

A side imports its plumbing from `@adminiumjs/adminium/side`. The build supplies that module from
the Adminium doing the building, so it always matches the server that serves the side.

A **staff side** runs inside Adminium, as the person who is signed in. It has no key:

```tsx
import { useStaff } from '@adminiumjs/adminium/side';

const loaded = useStaff();
if (loaded.state === 'ready') {
  const { rows } = await loaded.value.list('jobs', { order: 'id.desc' });
  await loaded.value.create('jobs', { title: 'Fix the door' });
}
```

`list`, `get`, `create`, `update` and `remove` take a table's short name — the `ref` in its part
file — and act with the signed-in person's own permissions; `can(table, action)` says whether a
button is worth showing. The session also carries `user`, the app's `settings`, the venue's
`timezone` and `currency`. When the database has no time zone set, `timezone` is `UTC` and
`timezoneIsFallback` is true: a screen should say so, and must never use the browser's zone
instead.

A **customer side** is public. `useCustomer()` gives it the browser key Adminium serves and the
address of the [public API](https://docs.adminium.dev/guides/public-api/endpoints-and-keys/), and the side makes its client
with `@adminiumjs/public-client`:

```tsx
import { createPublicClient } from '@adminiumjs/public-client';
import { useCustomer } from '@adminiumjs/adminium/side';

const loaded = useCustomer();
if (loaded.state === 'ready') {
  const client = createPublicClient(loaded.value);
  const jobs = await client.list(loaded.value.tables['jobs'] ?? 'jobs');
}
```

That client reaches only what `access.json` grants.
