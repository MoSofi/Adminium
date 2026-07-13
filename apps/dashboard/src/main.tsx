/**
 * Entry (09-generated-app.md §2.1): the pre-hydration guard already ran from
 * index.html (inline literal of @adminium/tokens preHydrationScript), so the
 * first paint carries the cached theme axes. Mount QueryClient + Router; the
 * app-layout route issues the single GET /api/v1/bootstrap.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createQueryClient } from './app/query.js';
import { createAppRouter } from './app/router.js';
import './styles.css';

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

const container = document.getElementById('root');
if (container === null) throw new Error('missing #root container');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
