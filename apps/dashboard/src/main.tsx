/**
 * Entry (09-generated-app.md §2.1): the pre-hydration guard already ran from
 * index.html (inline literal of @adminium/tokens preHydrationScript), so the
 * first paint carries the cached theme axes. The i18n instance is awaited
 * BEFORE the first render (10-i18n-theming.md §7.5 — en-US is bundled and
 * synchronous; other locales are capped at 2 s with an en-US hot-swap), then
 * QueryClient + Router mount; the app-layout route issues the single
 * GET /api/v1/bootstrap.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@adminium/i18n/react';

import { exchangeBootToken } from './desktop/bootToken.js';
import { captureBridgeTicket } from './studio/connect/bridgeSeed.js';
import { initDashboardI18n } from './i18n/setup.js';
import { createQueryClient } from './app/query.js';
import { createAppRouter } from './app/router.js';
import './styles.css';

async function start(): Promise<void> {
  // BEFORE the router (11-electron.md §2.2 step 8, §5). Two reasons, both hard:
  // the token has to leave `window.location` before anything can read it into
  // router state or a `Referer` header, and the session cookie has to exist
  // before the app route's bootstrap query decides login-vs-dashboard. A no-op
  // on every non-desktop boot — see `desktop/bootToken.ts`.
  await exchangeBootToken();

  // Same placement, same two reasons (see `studio/connect/bridgeSeed.ts`): the
  // ticket has to leave `window.location` before the router can copy it or a
  // `Referer` can carry it, and on a fresh install the first route to render is
  // `/setup`, not the `/studio/connect` the site redirected to.
  captureBridgeTicket();

  const i18n = await initDashboardI18n();

  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient);

  const container = document.getElementById('root');
  if (container === null) throw new Error('missing #root container');

  createRoot(container).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nProvider>
    </StrictMode>,
  );
}

void start();
