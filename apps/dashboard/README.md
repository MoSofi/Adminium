# @adminium/dashboard

React 19 + Vite 7 SPA: the Generated App shell (M4 Wave A — 09-generated-app.md §2, §5, §6).

## What's here (M4-T01/T06/T07)

- **Boot** (`src/main.tsx`, `src/app/`): pre-hydration inline script in `index.html`
  (literal copy of `@adminium/tokens` `preHydrationScript`, sync-tested), one
  `GET /api/v1/bootstrap` round trip (`app/bootstrap.ts`), TanStack Query client with
  the API-error → system-state mapping (`app/query.ts`), WS client with SSE fallback
  subscribing `config-changed` → invalidation (`app/ws.ts`).
- **Router** (`app/router.tsx`): code-based TanStack Router tree — public auth group
  (`/login`, `/forgot`, `/reset/$token`, `/otp`), session-guarded layout with
  `returnTo` redirect, `/` → first Workspace nav item, dynamic `/p/$slug`
  (PageRenderer STUB until Wave B), `/account/*` placeholder, `/state/$stateId`,
  branded 404 catch-all. `hrefForPage`/`hrefForRecord` link helpers.
- **Shell** (`src/shell/`): 256px sidebar (logo + version chip, five fixed nav groups,
  persona footer), sticky translucent topbar (⌘K search affordance, theme toggle,
  bell placeholder, avatar menu), ⌘K palette (`app/palette/`), shortcuts panel from
  the live registration set, global keyboard manager (`app/shortcuts.ts`) with
  typing-context suppression, platform mapping, and data-driven G-chords.
- **System states** (`src/states/`): all 12 §6.1 variants (`StateHero` + `stateMap`),
  reachable at `/state/$stateId`, wired to route `errorComponent`s.

## Dev

```sh
pnpm --filter @adminium/server demo:m2   # or any server on :4600
pnpm --filter @adminium/dashboard dev    # vite on :5173, proxies /api + /ws → :4600
```

## Serving the build

`pnpm --filter @adminium/dashboard build` emits `dist/`. The server picks it up via
its static plugin: `buildServer({ staticRoot: 'apps/dashboard/dist' })` — SPA
fallback for non-`/api` GETs included (apps/server/src/plugins/static.ts).

## Deferred to Wave B / later

- PageRenderer pipeline (validate/migrate/template mount, 09-T03), `/welcome`,
  `/search`, Studio routes, `/signup` (no server endpoint yet).
- `GET /api/v1/search` palette group + Recent tracking (M4-T06 note in
  `app/palette/CommandPaletteHost.tsx`); notification center (M7).
- i18n: strings flow through the `src/i18n/t.ts` stub until M8.
