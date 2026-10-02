<!-- produced from apps/docs/src/content/docs/projects/apps.md § Run it from the folder — On a server; do not edit -->

# An app in your project: Run it from the folder — On a server

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
| A table or column that holds nothing, taken out | Dropped | Kept: a server drops nothing |

Which of the two a server is depends on how the process was started, never on a file: a
`ADMINIUM_PROJECT_MODE` line in the project's `.env` is ignored, so a deployed folder cannot turn a
server into a developer's machine.

An add-on an app requires has to be on the server for either of them to use it: uploaded in
**Studio → Add-ons**, downloaded from the catalogue, or bundled — each `<key>-<version>.tgz` beside
its `.tgz.integrity` in an `add-ons-bundle/` folder in the project
([Installing add-ons](https://docs.adminium.dev/self-hosting/installing-add-ons/#adminium_bundled_add_ons)). Without it the app
is not applied, and the message names the add-on.

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
| `publicAccess` | `true` gives the app, on a server, the public access its manifest declares. It is the one deliberate switch: committed, reviewed, and read nowhere else. Setting it is applied on the next start, with no change to the app. Taking it out again does **not** take the access back: the server warns at each start that the app has access the config does not allow, and it is revoked under **Settings → API** |
| `sampleData` | `false` stops `adminium dev` adding the sample data on the first install |

On a server the public API also has to be there for a customer side to reach anything: set
[`ADMINIUM_PUBLIC_API_ORIGINS`](https://docs.adminium.dev/self-hosting/env-vars/) and switch it on in **Settings → API**.
[`adminium check`](https://docs.adminium.dev/reference/cli/#check) warns about an app that declares public access the config
has not allowed. A database that `adminium dev` once ran against keeps the access dev gave: a server
started on it warns the same way.

`adminium dev` switches the public API on by itself for an app that declares public access, and
records it in the audit log. It listens on every address of the machine unless told otherwise, so on
a shared network start it with `--host 127.0.0.1`; the terminal says so when it applies.
