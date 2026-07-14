/**
 * Vitest setup for @adminium/widgets. Default environment is `node` (the
 * page-config / registry-metadata tests are DOM-free); React frame/host tests
 * opt into happy-dom per file via `// @vitest-environment happy-dom`. No
 * `globals: true`, so Testing Library auto-cleanup does not apply — register
 * it here (no-op in node-environment files where nothing mounts).
 */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
