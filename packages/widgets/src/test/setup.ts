/**
 * Vitest setup for @adminium/widgets. Default environment is `node` (the
 * page-config / registry-metadata tests are DOM-free); React frame/host tests
 * opt into happy-dom per file via `// @vitest-environment happy-dom`. No
 * `globals: true`, so Testing Library auto-cleanup does not apply — register
 * it here (no-op in node-environment files where nothing mounts).
 */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Deliberately does NOT raise `asyncUtilTimeout`. Some suites use
 * `findByTestId(...).catch(() => undefined)` as a BOUNDED tolerant wait — the
 * media "renders without crashing" tests expect that lookup to time out fast
 * (the testid never appears) and then assert no error boundary tripped. A
 * global async-timeout bump turns that intentional short wait into a full-length
 * one and blows the test budget. Where a real wait genuinely needs headroom
 * under CI contention, raise it per call with `waitFor(cb, { timeout })`.
 */
afterEach(() => {
  cleanup();
});
