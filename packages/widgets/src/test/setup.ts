/**
 * Vitest setup for @adminium/widgets. Default environment is `node` (the
 * page-config / registry-metadata tests are DOM-free); React frame/host tests
 * opt into happy-dom per file via `// @vitest-environment happy-dom`. No
 * `globals: true`, so Testing Library auto-cleanup does not apply — register
 * it here (no-op in node-environment files where nothing mounts).
 */
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * `asyncUtilTimeout` covers every `waitFor`/`findBy*` in the package — 77 of
 * them, and until now every one sat on Testing Library's 1000ms default.
 *
 * That default is not enough on a contended CI runner. These suites mount
 * through `WidgetHost`, whose lazy component barrel resolves through Suspense,
 * and a cache-cold `verify` run (a lockfile change invalidates nearly every
 * turbo hash, so the whole monorepo rebuilds and retests at once) is slow
 * enough for chunk resolution to lose the race: `PageDashboard.test.tsx` failed
 * as "expected 4 KPI cards, got 0" — a `waitFor` that expired, not a render
 * that broke. Any of the other 76 could have drawn that straw instead, which is
 * why this is set globally rather than patched at the one call site that lost.
 *
 * This was previously left at the default to protect ONE call site: the media
 * "renders without crashing" tests use `findByTestId(...).catch(() => undefined)`
 * as a deliberately BOUNDED wait, and a global bump would stretch that
 * intentional short wait. Inverted here — the single deliberate short wait now
 * passes its own explicit `{ timeout }` (media-widgets.test.tsx), so the 76
 * genuine waits get headroom instead of the exception setting the budget.
 *
 * 5s stays well under the 20s `testTimeout` (vitest.config.ts), so a wait that
 * is genuinely stuck still fails as itself rather than as a test-level timeout.
 */
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
});
