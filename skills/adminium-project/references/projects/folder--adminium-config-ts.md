<!-- produced from apps/docs/src/content/docs/projects/folder.md § `adminium.config.ts`; do not edit -->

# The project folder: `adminium.config.ts`

```ts
import { defineConfig, env } from '@adminiumjs/adminium';

export default defineConfig({
  databases: {
    main: { url: env('DATABASE_URL') },
  },
});
```

`env('NAME')` reads an environment variable when the config loads, with an
optional fallback: `env('DATABASE_URL', 'sqlite:./data/dev.db')`. Keep passwords
out of this file — it is committed — and let `env()` read them from `.env` or
from the host.

Everything here maps onto an environment variable, and **a variable that is
already set wins**, so a host's settings always override the file:

| Setting | | Variable it stands for |
|---|---|---|
| `databases.<key>.url` | The database the admin is built from ([below](https://docs.adminium.dev/projects/folder/#several-databases)) | — |
| `server.port` | Port to listen on. Default 4600. | `PORT` |
| `server.host` | Address to bind. Default `0.0.0.0`. | `HOST` |
| `metaStore.url` | Adminium's own database. Unset means a SQLite file in the data folder. | `ADMINIUM_META_URL` |
| `dataDir` | Where Adminium keeps its own files, relative to the project. Default `data`. | `ADMINIUM_DATA_DIR` |
| `storage.url` | Where uploads and exports go. Unset means the data folder. | `ADMINIUM_STORAGE_URL` |
| `apps.<key>` | What an [app in the project](https://docs.adminium.dev/projects/apps/#on-a-server) is allowed: its `database`, `publicAccess` on a server, `sampleData` under `dev` | — |

Nothing else belongs in it: `ADMINIUM_SECRET` and every other variable stay in
the environment. The full list is
[Environment variables](https://docs.adminium.dev/self-hosting/env-vars/).

`.mts`, `.js` and `.mjs` config files work too. The project is the nearest
folder, from the current one upwards, that holds one — or the folder
`ADMINIUM_PROJECT_DIR` names, which is how the
[project image](https://docs.adminium.dev/projects/deploy/) points a server at a folder it does not run
from.
