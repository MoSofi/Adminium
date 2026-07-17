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
# rebuild native modules for Electron's ABI (see below), then:
pnpm --filter @adminium/e2e e2e:desktop
# or, with build ordering handled by turbo:
pnpm turbo run e2e:desktop --filter=@adminium/e2e
```

**Prerequisites (why it is CI-only, not run in-repo on every commit):**

1. A **display** — `_electron` launches a real Electron window.
2. A **built** desktop app (`out/**`).
3. **Native modules rebuilt for Electron's ABI.** A plain `electron-vite build`
   does *not* rebuild `better-sqlite3`/`argon2` for Electron (see
   `apps/desktop/package.json` `//native-modules` for why that cannot be a
   workspace `postinstall`). Without the rebuild the utilityProcess server crashes
   at boot and the specs fail on the crash screen. In the desktop-e2e CI job, run
   e.g. `pnpm --filter @adminium/desktop exec electron-builder install-app-deps`
   between build and run — the job runs only Playwright, so rewriting the shared
   `better-sqlite3` copy is safe there (it would break Node-ABI vitest suites in a
   shared job).
