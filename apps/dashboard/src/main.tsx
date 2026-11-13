// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Entry: the pre-hydration guard already ran from index.html (inline literal
 * of @adminium/tokens preHydrationScript), so the first paint carries the
 * cached theme axes. The i18n instance is awaited BEFORE the first render
 * (en-US is bundled and synchronous; other locales are capped at 2 s with an
 * en-US hot-swap), then QueryClient + Router mount; the app-layout route
 * issues the single GET /api/v1/bootstrap.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BRIDGE_PARAM } from './studio/connect/bridgeTicket.js';
import { LiveI18nProvider } from './i18n/LiveI18nProvider.js';
import { initDashboardI18n } from './i18n/setup.js';
import { createQueryClient } from './app/query.js';
import { createAppRouter } from './app/router.js';
import { setRefusalLoader } from './app/refusals.js';
import './styles.css';

async function start(): Promise<void> {
  // BEFORE the router. Two reasons, both hard:
  // the token has to leave `window.location` before anything can read it into
  // router state or a `Referer` header, and the session cookie has to exist
  // before the app route's bootstrap query decides login-vs-dashboard. A no-op
  // on every non-desktop boot — see `desktop/bootToken.ts`. Only the desktop's own
  // window opens with the token (`BOOT_TOKEN_PARAM` there), so only it downloads the code.
  const query = new URLSearchParams(window.location.search);
  if (query.has('bootToken')) await (await import('./desktop/bootToken.js')).exchangeBootToken();
  // Adminium Designer's one-use link, for the same two reasons. Only a page
  // opened with the link downloads the code that takes it (`designer/designToken.ts`).
  if (window.location.hash.startsWith('#designToken=')) await (await import('./designer/designToken.js')).exchangeDesignToken();

  // Same placement, same two reasons (see `studio/connect/bridgeSeed.ts`): the
  // ticket has to leave `window.location` before the router can copy it or a
  // `Referer` can carry it, and on a fresh install the first route to render is
  // `/setup`, not the `/studio/connect` the site redirected to. Only a page opened
  // with a ticket downloads the code that takes it.
  if (query.has(BRIDGE_PARAM)) (await import('./studio/connect/bridgeSeed.js')).captureBridgeTicket();
  // The way back from an operator's connect service ("Connect Supabase"), for the same reasons. Only a page
  // opened at that address downloads the code that reads it.
  if (window.location.pathname.startsWith('/connect/')) (await import('./connect/connectReturn.js')).captureConnectReturn();

  await initDashboardI18n();
  // A refusal the operator's switches cause is said in the person's words: that chunk, once one comes.
  setRefusalLoader(() => import('./app/refusalWords.js'));

  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient);

  const container = document.getElementById('root');
  if (container === null) throw new Error('missing #root container');

  createRoot(container).render(
    <StrictMode>
      {/* The live instance: an override rebuild replaces the one boot made. */}
      <LiveI18nProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </LiveI18nProvider>
    </StrictMode>,
  );
}

void start();
