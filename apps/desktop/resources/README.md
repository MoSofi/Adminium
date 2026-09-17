# `resources/` — packaged, non-code assets

Everything here is copied into the app by electron-builder (`files: ["out/**",
"resources/**"]`) and is reachable at runtime under `process.resourcesPath`.

| Path | Owner | Contents |
|---|---|---|
| `icons/` | `icon.icns`, `icon.ico`, `icons/{16..1024}.png` — all DERIVED from the 1024 px master by `scripts/make-icons.mjs` (sharp + icon-gen), never hand-exported, so an accent change re-derives cleanly. |
| `demo/demo-seed.mjs` | The demo database: the Ava Reyes team-ops domain, seeded through the server into `<dataDir>/databases/demo.sqlite`. A SCRIPT, not a prebuilt binary — it keeps the installer small and the seed reviewable. |
| `THIRD-PARTY-NOTICES.txt` | Generated at build by `scripts/generate-notices.mjs`; the build fails if generation fails. Never hand-edited. |

The dashboard build does NOT live here: `electron.vite.config.ts` copies it to
`out/dashboard/`, and the server serves it through its existing static handler.
