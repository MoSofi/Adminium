// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * The desktop suites run in plain Node — a real Electron app cannot be launched
 * headlessly, and the end-to-end shell is 11-T20's Playwright `_electron` suite.
 * What is unit-tested here is the pure logic: the handshake protocol, the config
 * schema/migration, the restart policy, the URL/navigation policy, and the boot
 * wiring (which is injectable for exactly this reason — see src/main/index.ts).
 *
 * The `electron` alias is what makes that possible. The real `electron` npm
 * package's main export is a STRING (the path to the binary), so a module that
 * does `import { app } from 'electron'` cannot even be loaded outside Electron.
 * The alias swaps in a module with the same named exports, present but inert;
 * production code never sees it (the alias lives here, not in the build config),
 * and no test asserts against it — tests inject their own fakes.
 */
const electronStub = fileURLToPath(new URL('./src/test/electron-stub.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^electron$/, replacement: electronStub }],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
