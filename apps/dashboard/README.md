# @adminium/dashboard

React 19 + Vite 7 SPA: the Generated App shell (09-generated-app.md §2, §5, §6).

## What's here

- **Boot** (`src/main.tsx`, `src/app/`): pre-hydration inline script in `index.html`
  (literal copy of `@adminium/tokens` `preHydrationScript`, sync-tested), one
  `GET /api/v1/bootstrap` round trip (`app/bootstrap.ts`), TanStack Query client with
  the API-error → system-state mapping (`app/query.ts`), WS client with SSE fallback
  subscribing `config-changed` → invalidation (`app/ws.ts`).
- **Router** (`app/router.tsx`): code-based TanStack Router tree — public auth group
  (`/login`, `/forgot`, `/reset/$token`, `/otp`), session-guarded layout with
  `returnTo` redirect, `/` → first Workspace nav item, dynamic `/p/$slug` rendered by
  the real `PageRenderer` pipeline (`src/pages/PageRenderer.tsx` — validate/migrate/
  template mount), `/welcome`, `/account` + `/account/preferences` +
  `/account/notifications`, Studio routes (`src/studio/routes.tsx`),
  `/state/$stateId`, branded 404 catch-all. `hrefForPage`/`hrefForRecord` helpers.
- **Shell** (`src/shell/`): 256px sidebar (logo + version chip, five fixed nav groups,
  persona footer), sticky translucent topbar (⌘K search affordance, theme toggle,
  notification center, avatar menu), ⌘K palette (`app/palette/`), shortcuts panel from
  the live registration set, global keyboard manager (`app/shortcuts.ts`) with
  typing-context suppression, platform mapping, and data-driven G-chords.
- **System states** (`src/states/`): all 12 §6.1 variants (`StateHero` + `stateMap`),
  reachable at `/state/$stateId`, wired to route `errorComponent`s.
- **i18n**: strings flow through `src/i18n/t.ts`, backed by the shared i18next
  instance (`@adminium/i18n`) after `initDashboardI18n()`.

## Dev

```sh
pnpm --filter @adminium/server demo:m2   # or any server on :4600
pnpm --filter @adminium/dashboard dev    # vite on :5173, proxies /api + /ws → :4600
```

## Serving the build

`pnpm --filter @adminium/dashboard build` emits `dist/`. The server picks it up via
its static plugin: `buildServer({ staticRoot: 'apps/dashboard/dist' })` — SPA
fallback for non-`/api` GETs included (apps/server/src/plugins/static.ts).

## Still missing

- `GET /api/v1/search`: the palette's async `Records` group + mixed-entity Recent
  tracking (M4-T06 note in `app/palette/CommandPaletteHost.tsx`) — the palette
  searches the nav tree client-side only until the server grows the endpoint.
- `/signup` (no server endpoint yet).
