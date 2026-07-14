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
