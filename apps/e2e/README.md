# @adminium/e2e

Playwright end-to-end matrix (M9-T05 / 01-T10): the **built** server serving
the **built** dashboard, seeded with the Northwind demo fixture, driven on
all three v1 engines. `scripts/e2e-server.mjs` prepares the source database,
boots the composed server, seeds over the real API (login → connection →
introspect → generate), and only then starts listening — so Playwright's
readiness probe (`/api/v1/healthz`) implies "fully seeded".

## Run locally

Build first (or let turbo do it — the `e2e` task depends on `^build`):

```sh
pnpm turbo run build --filter=@adminium/e2e...
pnpm --filter @adminium/e2e exec playwright install chromium   # once
```

### sqlite (default — zero external services)

```sh
pnpm turbo run e2e --filter=@adminium/e2e
# or: pnpm --filter @adminium/e2e e2e
```

### postgres

Point `TEST_POSTGRES_URL` at a superuser-ish DSN; the script (re)creates the
`adminium_e2e` database on that server:

```sh
E2E_ENGINE=postgres TEST_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
  pnpm --filter @adminium/e2e e2e
```

The Studio connect-wizard spec only runs on this leg.

### mysql

Same variable as the adapter-mysql live suite (`TEST_MYSQL_URL`):

```sh
E2E_ENGINE=mysql TEST_MYSQL_URL=mysql://root:root@127.0.0.1:3306 \
  pnpm --filter @adminium/e2e e2e
```

## RTL / locale leg

`tests/rtl-locale.spec.ts` boots the real app in `ar_EG` — the one thing the
unit tests cannot do. `ThemeProvider.test.tsx` proves the provider *would* stamp
`dir`, and `parity.test.ts` proves the bundles *have* Arabic, but neither renders
a page, so a physical `left-0` or a never-rendered translation stays invisible to
both.

It asserts three independent things, because they fail independently:

1. `<html lang="ar-EG" dir="rtl">`, and that switching back to `en_US` flips it —
   direction is derived from the locale, never set on its own (02 §4.2).
2. Real Arabic glyphs reach the DOM. `dir="rtl"` over English text is trivial to
   produce and proves nothing about the bundles.
3. Fixed-LTR islands (10 §5.6) did **not** mirror. This is the failure nobody
   looks for, because a wrongly-mirrored connection string makes the page look
   *more* RTL, not broken.

It restores `en_US` in `afterEach`: the suite runs serially against one seeded
account, so a mid-spec failure must not leave it in Arabic for the next file.

## Debugging

- `pnpm --filter @adminium/e2e e2e -- --ui` — Playwright UI mode.
- `pnpm --filter @adminium/e2e e2e:server` — boot the seeded server alone
  and browse http://127.0.0.1:4610 (credentials are printed on boot).
- Failure traces land in `apps/e2e/test-results/`; open with
  `pnpm --filter @adminium/e2e exec playwright show-trace <trace.zip>`.

CI runs the three legs as separate jobs in `.github/workflows/e2e.yml`
(postgres:16 / mysql:8.4 service containers), uploading traces and the HTML
report only on failure.

## Desktop (`_electron`) suite — 11-T20

A second, independent suite (`tests-desktop/`, config
`playwright.desktop.config.ts`, project `desktop-e2e`) drives the **built
Electron app** (`apps/desktop/out/main/index.js`) via Playwright's `_electron`.
It launches the app against a hermetic `--user-data-dir` and walks 11-electron.md
§6/§7/§9:

- **`desktop-app.spec.ts`** — first-run → demo DB → dashboard → CRUD edit →
  chart render → backup, plus the §2.4 renderer security posture (contextIsolation
  on, sandbox on, nodeIntegration off, navigation locked to loopback, external
  links open the system browser).
- **`desktop-offline.spec.ts`** — the §7 offline smoke: `session.webRequest`
  deny-all except `127.0.0.1`; the same walk; assert **zero** blocked requests
  (no Google Fonts, no tiles, no CDN). Launched with `ADMINIUM_DISABLE_UPDATES=1`
  (updates off) and telemetry off.
- **`desktop-crash-wal.spec.ts`** — commit a write, SIGKILL the app, relaunch the
  same data dir, assert the committed data survived (WAL durability, §9).

It is **not** part of `pnpm test` — apps/e2e has no `test` script, so exactly like
the engine legs it stays out of the repo-wide gate. Run it explicitly:

```sh
pnpm --filter @adminium/desktop build          # produces out/**
pnpm --filter @adminium/e2e e2e:desktop
# or, with build ordering handled by turbo:
pnpm turbo run e2e:desktop --filter=@adminium/e2e
```

**Prerequisites (why it is CI-only, not run in-repo on every commit):**

1. A **display** — `_electron` launches a real Electron window.
2. A **built** desktop app (`out/**`).

**A third prerequisite used to apply and no longer does**: "native modules
rebuilt for Electron's ABI". A plain `electron-vite build` does not rebuild
`better-sqlite3`/`argon2`, and without that rebuild the utilityProcess server
crashed at boot and the specs failed on the crash screen — so the desktop-e2e job
runs `electron-builder install-app-deps` between build and run.

Both addons are Node-API now (`better-sqlite3` >= 13, `argon2` >= 0.44), and an
N-API binary loads under Electron and plain Node alike, so the rebuild is no
longer a precondition for this suite. The CI step is retained as a harmless
no-op — see the header of `apps/desktop/electron-builder.yml` for the
resolution-order detail (better-sqlite3 prefers its bundled prebuild over
`build/Release`, argon2 the reverse) and for why `npmRebuild` has not been turned
off in the same breath as documenting it.

The old warning that rewriting the shared `better-sqlite3` copy would break
Node-ABI vitest suites in a shared job is likewise obsolete: there is only one
ABI now. `apps/desktop/package.json` `//native-modules` still explains why this
can never be a workspace `postinstall`, which is unchanged.
