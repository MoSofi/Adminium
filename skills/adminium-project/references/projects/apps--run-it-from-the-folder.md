<!-- produced from apps/docs/src/content/docs/projects/apps.md § Run it from the folder; do not edit -->

# An app in your project: Run it from the folder

```bash
npm run dev
```

[`adminium dev`](https://docs.adminium.dev/reference/cli/#dev) runs the app straight from its folder. Nothing is packed or
uploaded: on start it checks each app under `apps/`, puts its manifest together, builds its screens
and installs it on the project's first database, with its sample data. The terminal says so:

```
App "repairs" installed from apps/repairs. Tables made: repairs_items, repairs_requests.
App "repairs": its sample data was added.
```

From then on, save a file and it is applied while the server runs. Nothing restarts:

| You change | What happens |
|---|---|
| a part of the manifest (`tables/`, `pages/`, `roles.json`, `access.json`, …) | The app is applied again in place: new tables are made, the app's own tables gain their new columns, its pages, roles, rules and emails are rewritten, and its rows stay. The version need not change. Open dashboards show the change |
| a screen (`staff/src/…`, `customer/src/…`, `nav.json`) | The side is built again and served, and an open screen of it reloads |
| `seeds/` | Nothing: sample data is added once, on the first install |
| a new folder under `apps/` | The new app is installed |

A change that cannot be applied — a column that must hold a value no two rows may share, while two
rows already do — leaves the app running exactly as it was. The terminal says what stopped it, Studio
marks the app **Not applied** with the same sentence, and the same files are not tried again until
you change them (or restart). A manifest that does not check is said with its file and field, as
[`app check`](https://docs.adminium.dev/projects/apps/#check-it) would say it, and the app keeps what it had.

A screen reloads because the module it imports from, `@adminiumjs/adminium/side`, asks the server
once a second whether the app was rebuilt. That works on a customer screen too, where nobody is signed
in. A screen that should do something other than reload calls `stopReloading()` and passes its own
listener to `onAppChanged(listener)`. A packed app never asks.

Studio lists the app as **From this project's folder**, and the folder decides what it is: Studio does
not install, update or uninstall it while `apps/<key>/` is there, and a package may not be uploaded
under its key (`KEY_IN_PROJECT`). Deleting the folder does not uninstall it — a branch checked out
from before the app existed would otherwise take its pages and roles with it. The app stays
installed, marked **Folder gone**, until you uninstall it in Studio.

### Taking things out

When the manifest no longer declares something, the next apply deals with it:

| Taken out of the manifest | What happens |
|---|---|
| a page | Removed. A page somebody edited in Studio is kept, as an ordinary page of yours |
| a role | Removed with its grants. The terminal says how many people and API keys held it |
| all of its emails, or all of its documents | Removed, as an uninstall removes them |
| what the customer side may reach | Taken back from the app's key at once |
| a table or a column **that holds nothing** | Dropped |
| a table or a column **that holds data** | Kept, and asked about |
| a column that now holds less (a shorter text, an option taken away, a value now required) | Never changed in the database. The rows that no longer fit are counted and stay as they are; new writes follow the new rule |

Nothing that holds data is dropped on the way. The rest of the manifest is applied, and the question
waits in **Studio → Hosted apps**, under the app:

```
apps/repairs/ no longer declares these, and they hold data. Nothing was removed.
  · The column repairs_items.colour: 2 rows hold a value
[Keep the data]  [Remove them]
```

**Keep the data** leaves the table or column in the database and takes it out of the app; the same
manifest does not ask again. **Remove them** drops them, with their data, and takes a second click
and a Super Admin. The same question can be read and answered without Studio:
`GET /api/v1/project/apps/<key>/removals`, and `POST` the same address with `{ "accept": true }` or
`{ "accept": false }`.

### On a server

A deployed project runs its apps the same way, from what [`adminium build`](https://docs.adminium.dev/reference/cli/#build)
left in `.adminium/build/` — the project's Dockerfile runs it in its build stage, and a server builds
nothing. `adminium start` applies each app before it answers its first request, and a server is
careful where `adminium dev` is generous:

| | `adminium dev` | `adminium start` |
|---|---|---|
| Database | The first one in `databases`, or the app's `database` below | The same |
| Public access the manifest declares | Given, and the public API is switched on for it | **Not given**, unless the config says `publicAccess: true` |
| Add-ons the app requires | Installed or updated with it | Must already be installed; otherwise the app is not applied |
| A table the app did not make itself | Gains the columns the app needs | Never changed: the app is not applied, and the message names the table |
| Sample data | Added once, on the first install | Never |
| A table or column that holds data, taken out | Asked about | Kept, released from the app, and said in the log |

An app needs no settings. When one does, `adminium.config.ts` takes them by the app's key:

```ts
export default defineConfig({
  databases: {
    main: { url: env('DATABASE_URL') },
    shop: { url: env('SHOP_DATABASE_URL') },
  },
  apps: {
    repairs: { database: 'shop', publicAccess: true, sampleData: false },
  },
});
```

| Setting | |
|---|---|
| `database` | The key under `databases` the app's tables live in. Default: the first |
| `publicAccess` | `true` gives the app, on a server, the public access its manifest declares. It is the one deliberate switch: committed, reviewed, and read nowhere else |
| `sampleData` | `false` stops `adminium dev` adding the sample data on the first install |

On a server the public API also has to be there for a customer side to reach anything: set
[`ADMINIUM_PUBLIC_API_ORIGINS`](https://docs.adminium.dev/self-hosting/env-vars/) and switch it on in **Settings → API**.
[`adminium check`](https://docs.adminium.dev/reference/cli/#check) warns about an app that declares public access the config
has not allowed.
