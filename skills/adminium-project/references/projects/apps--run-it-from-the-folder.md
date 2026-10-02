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
