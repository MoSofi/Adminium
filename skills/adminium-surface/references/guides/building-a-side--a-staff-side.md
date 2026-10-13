<!-- produced from apps/docs/src/content/docs/guides/apps/building-a-side.md § A staff side; do not edit -->

# Building an app's screens: A staff side

```tsx
import { useEffect, useState } from 'react';
import { useStaff, type Row, type StaffSession } from '@adminiumjs/adminium/side';

export function App() {
  const loaded = useStaff();
  if (loaded.state === 'loading') return <p>Loading…</p>;
  if (loaded.state === 'error') return <p>{loaded.message}</p>;
  return <Jobs staff={loaded.value} />;
}

function Jobs({ staff }: { staff: StaffSession }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    void staff.list('jobs', { order: 'id.desc' }).then((listed) => setRows(listed.rows));
  }, [staff]);
  return <ul>{rows.map((row) => <li key={String(row.id)}>{String(row.title)}</li>)}</ul>;
}
```

The session `useStaff()` gives:

| | |
|---|---|
| `list(table, options?)` | Rows and the total. `options`: `limit` (at most 200, default 50), `offset`, `order` (`"created_at.desc"`), `q` (a search), `where` (a filter, as the data API takes it) |
| `get(table, id)` | One row |
| `create(table, values)` | Adds a row and returns it |
| `update(table, id, values)` | Changes a row and returns it |
| `remove(table, id)` | Deletes a row |
| `can(table, action)` | Whether the signed-in person may `read`, `create`, `update` or `delete` there. Use it to leave out a button whose write would be refused |
| `user` | `{ id, name, email }` of the person signed in |
| `settings` | The app's settings values |
| `timezone`, `timezoneIsFallback`, `currency` | The venue's, see below |
| `tables` | The real name of each table in the database |

`table` is the short name: the `ref` in `manifest/tables/<ref>.json`. Adminium names the real table
`<key>_<ref>` when the app is `prefixed`, and the session maps one to the other.

A refused write throws an error whose `message` is the server's own sentence and whose `code` is
its error code. On a staff screen, show the message: it names the column and says what is wrong.

A column that holds personal data (a name, a phone, an email) reads as empty to a person whose
role lacks `read_pii` on that table. A screen that shows customers' details needs a role that
grants it; see [Add a role](https://docs.adminium.dev/guides/apps/manifest-by-task/#add-a-role).

`adminium app build` bundles the code and does not type-check it. To type-check a side, add
`typescript` to the project and a `tsconfig.json` that includes `apps/`.

A staff screen can also draw one of Adminium's own larger parts, such as the text box in which
people are mentioned, without bundling it: see
[Adminium's own parts on an app's screen](https://docs.adminium.dev/guides/apps/kit-parts/).

The person must hold a role that may open the app's staff screens (`app:@:staff` in the app's
`roles.json`), and their grants on the app's tables decide what the reads and writes above may do.
See [App roles and staff access](https://docs.adminium.dev/guides/apps/roles-and-staff-access/).

### Its place in the dashboard

`nav.json` lists the screens the staff side offers the dashboard's sidebar:

```json
[
  { "id": "jobs", "path": "", "label": "Jobs", "icon": "wrench" },
  { "id": "done", "path": "done", "label": "Done" }
]
```

`path` is the address of that screen inside the side, without its first slash: `""` is the first
page, `"done"` is the page at `/done`. It is added to wherever the side is opened, so it never
starts with `/`. `icon` is a [Lucide](https://lucide.dev) icon name. Each entry needs a page at
its address: see [Pages and their addresses](https://docs.adminium.dev/guides/apps/building-a-side/#pages-and-their-addresses).

The app's section of the sidebar is the manifest's to shape too. A generated page that the staff
side replaces can be [kept off the sidebar](https://docs.adminium.dev/reference/manifest/#a-page-kept-off-the-sidebar)
(`"offRail": true` in its `nav`): it still opens by its address and is still found by search, for
whoever may view it. An entry that is not a page ([`navLinks`](https://docs.adminium.dev/reference/manifest/#navlinks))
opens a screen of the staff side, or the dashboard's Automations or Emails showing only what the
app brought, or the app's own settings. And a table's records can open on the staff side wherever
Adminium links to one, a notice, its email, a search hit: see
[Where a record opens](https://docs.adminium.dev/reference/manifest/#where-a-record-opens).
