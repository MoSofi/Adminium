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
 * Testing Library's `waitFor` has its OWN 1000ms default, separate from
 * vitest's testTimeout. Many widget tests mount through `WidgetHost`, which
 * resolves a widget id to its component asynchronously (the lazy component
 * barrel), so the first `data-widget` node appears a tick or two after render.
 * On a fast dev machine that is well under 1s, but on a loaded CI runner — the
 * widgets suite runs in parallel with the live-DB and server suites on 2 cores
 * — the resolution has flaked past 1000ms (page-builder's
 * `document-canvas` wait, "expected null not to be null"). Raising the async
 * default gives every such wait headroom without touching a single assertion;
 * a genuinely stuck render still fails, just later.
 */
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
