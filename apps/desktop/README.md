# @adminium/desktop

The Electron shell: `@adminium/server` in a `utilityProcess`, the
`@adminium/dashboard` build served over loopback, fully offline.

Spec: **11-electron.md** (§2 topology + boot, §3 this layout, §4 preload
bridge, §5 session, §7 offline, §14 menus). Architecture: 01-architecture.md §4.4.

Zero business logic lives here (§1 principle 1). Anything feature-shaped belongs
in the server or the dashboard, gated by runtime flag.

## Layout (§3)

```
electron.vite.config.ts   four bundles — main / preload / renderer / the server entry
src/main/                 lifecycle, config, server manager, window, menu, updates, …
src/preload/index.ts      contextBridge (§4); built to CommonJS — a sandboxed
                          preload cannot be an ES module
src/server/index.ts       the utilityProcess entry: a thin wrapper (§2.1)
src/renderer/             boot.html / crash.html — the only pages that exist
                          before, or without, a server
resources/                packaged assets (icons, demo seed, notices) — see its README
build/                    electron-builder inputs — see its README
```

## Build

`pnpm --filter @adminium/desktop build` → `out/`:

| Output | What |
|---|---|
| `out/main/index.js` | the `main` field; ESM (Electron 43 ships Node 22) |
| `out/server/index.js` | the fork entry — a few KB of wrapper |
| `out/preload/index.cjs` | CommonJS, for `sandbox: true` |
| `out/renderer/{boot,crash}.html` + `tokens/` | the static pre-server pages |
| `out/dashboard/` | the SPA, copied from `@adminium/dashboard`'s `dist/` |

`turbo.json` declares `@adminium/desktop#build` after `dashboard#build` and
`server#build`, and overrides `outputs` to `out/**` — the repo-wide default is
`dist/**`, which would cache this package as producing nothing.

### `@adminium/server` is NOT bundled

§3's prose says the wrapper bundles it; we externalize instead, because §2.1 says
"a **thin wrapper**" and "`@adminium/server` runs **unmodified**" — and bundling
provably modifies it. `apps/server` does `new URL('../package.json',
import.meta.url)` path arithmetic at two different module depths; a bundle
flattens those depths, so the hops that agree in `dist/` cannot both be satisfied
afterwards. The full reasoning, with the two concrete failures, is in
`electron.vite.config.ts`'s header. Externalizing also makes 01 §4's "all four
deployment modes run the identical `@adminium/server` process" literally true.

Consequence: `package.json` declares packages **no line of `src/` imports** —
the adapters, the DB drivers, argon2. They are the forked server's runtime
resolution surface, not our import graph (which `.dependency-cruiser.cjs`
`desktop-shell-only` caps at `@adminium/server`). See the `//dependencies` note
in `package.json` before touching that list; a missing entry there fails
**silently at runtime**.

## Packaging locally

Three steps, in order (the release workflow drives the same sequence — see the
`//packaging` note in `package.json`):

```sh
pnpm turbo run build --filter=@adminium/desktop   # 1. out/**, notices, offline gate
pnpm --filter @adminium/desktop icons             # 2. derive resources/icons/*
pnpm --filter @adminium/desktop pack              # 3. --dir smoke (or `dist` for installers)
pnpm rebuild better-sqlite3 argon2                # 4. ← REQUIRED, see below
```

**Step 4 is not optional.** `electron-builder.yml` sets `npmRebuild: true`, and
electron-builder runs `@electron/rebuild` with `buildPath` = *this package
directory* — not, as its comment used to claim, a private staged copy. Under
pnpm, `apps/desktop/node_modules/better-sqlite3` is a symlink into the
workspace-shared store, so the rebuild recompiles the **one** copy that
`apps/server`, `apps/e2e`, `packages/meta` and `packages/adapter-sqlite` all
share, against Electron's ABI (`NODE_MODULE_VERSION` 148) instead of the local
Node's (127). Skip step 4 and the next `pnpm test` at the repo root fails with
`ERR_DLOPEN_FAILED` in packages you did not touch.

CI needs no equivalent step: each runner is discarded after the build. Isolating
the rebuild for real — packaging out of a `pnpm deploy --filter
@adminium/desktop` tree, which produces a genuinely private `node_modules` — is
the known follow-up.

## Testing

`pnpm --filter @adminium/desktop test`. A real Electron app cannot be launched
headlessly, so these suites cover the pure logic — the boot ORDER, the config
schema/migration, the handshake protocol, the restart policy, the URL policy.
`src/main/index.ts` takes injected ports for exactly this reason; `electron` is
aliased to an inert stub (see `vitest.config.ts`). The shell itself is 11-T20's
Playwright `_electron` suite.

To drive the real server outside Electron — the shape `src/server/index.ts`'s
self-start comment sanctions — export the §2.2 env block and run
`node out/server/index.js`; it prints its `ready` handshake and serves on a
random loopback port.

## Security posture (§2.4 — non-negotiable)

`contextIsolation` on, `sandbox` on, `nodeIntegration` off; navigation locked to
the loopback origin; external links via `shell.openExternal` after an
`https:`-only check; permission handler denies by default; the server binds
`127.0.0.1` on a random free port. LAN share (§8.3) is the only thing that may
ever pass `0.0.0.0`, and only on explicit opt-in.
