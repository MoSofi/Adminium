/**
 * The desktop build (11-electron.md §3), owned by 11-T01.
 *
 * FOUR bundles, not three. electron-vite's config surface is fixed at
 * `main` / `preload` / `renderer`, but §2.1 needs a fourth artifact — the
 * utilityProcess entry, "`apps/desktop/out/server/index.js`, a thin wrapper that
 * imports the exported `buildServer()` factory from `@adminium/server`". It has
 * no key of its own, so it rides in the `main` build: same Node target, same
 * externals, same format. `outDir` is widened from the default `out/main` to
 * `out`, and the two entries are named for their directories, so
 * `entryFileNames: '[name].js'` lands them at `out/main/index.js` (the
 * package.json `main`) and `out/server/index.js` (what ServerManager forks).
 * Sharing one rollup graph is a feature: the handshake contract in
 * `src/server/protocol.ts` is imported by both ends and is emitted once.
 *
 * ─── `@adminium/server` IS NOT BUNDLED ───────────────────────────────────────
 *
 * §3 says "the server wrapper bundles `@adminium/server` and its workspace deps
 * with externalized native modules". We deliberately do NOT, because §2.1 — the
 * topology section, the one that gives reasons — says the opposite twice, and it
 * is right: the fork entry is "**a thin wrapper** that imports the exported
 * factory", and `utilityProcess` "runs Electron's bundled Node, so
 * **`@adminium/server` runs unmodified**". Bundling modifies it. That is not a
 * stylistic claim; it was tried, and the bundle could not even be imported:
 *
 *  - `apps/server/src/version.ts` reads `new URL('../package.json',
 *    import.meta.url)` at MODULE SCOPE. From `apps/server/dist/version.js` that
 *    is the server's package.json. Rolled up into `out/server/index.js` it is
 *    `out/package.json`, which does not exist — every boot died with ENOENT
 *    before a line of ours ran.
 *  - `cli/allowlist.ts` does the same arithmetic TWO levels up (it lives at
 *    `dist/cli/`). A bundle flattens modules that lived at different depths into
 *    one file, so the two hops that agreed in `dist/` cannot both be satisfied
 *    afterwards — the LLM vocabulary silently vanished, taking the `/llm` routes
 *    with it (§6 step 4's BYO round-trip is an acceptance criterion).
 *
 * And the bundle was never self-contained anyway: the adapters, the DB drivers
 * and the vocabulary are all reached through COMPUTED `await import(specifier)`
 * calls that rollup cannot follow, so they stayed runtime imports regardless.
 * Bundling bought nothing and cost correctness. Externalizing makes 01
 * §4's "all four deployment modes run the identical `@adminium/server` process;
 * only the wrapper differs" literally true rather than approximately true — the
 * desktop app loads the same files `adminium start` does, resolved from
 * `apps/desktop/node_modules`, with their path arithmetic intact.
 *
 * `out/server/index.js` is therefore a few KB of wrapper. 11-T13 packages
 * `node_modules` into the asar (with `asarUnpack` for the `.node` binaries, §10).
 */

import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const src = (...segments: string[]): string => resolve(root, 'src', ...segments);

/**
 * §3 prod build: "copies the prebuilt `@adminium/dashboard` `dist/` into
 * resources; the server serves it via its existing static handler".
 *
 * The dashboard is a BUILD OUTPUT here, never an import (01-architecture.md §2.3
 * — desktop may use "dashboard build output (static files)" and nothing else of
 * it), so this resolves the package's directory rather than importing it, and
 * `desktop#build` depends on `dashboard#build` in turbo.json so `dist/` exists.
 * A miss is a hard error: a desktop build that silently shipped no SPA would
 * boot to a blank window and pass every gate we have.
 */
function copyDashboardBuild(): Plugin {
  return {
    name: 'adminium:copy-dashboard-build',
    apply: 'build',
    closeBundle() {
      const require = createRequire(import.meta.url);
      const pkgJson = require.resolve('@adminium/dashboard/package.json');
      const dist = resolve(dirname(pkgJson), 'dist');
      if (!existsSync(resolve(dist, 'index.html'))) {
        throw new Error(
          `@adminium/dashboard build not found at ${dist}. Run \`pnpm --filter @adminium/dashboard build\` ` +
            '(turbo does this via the desktop#build ← dashboard#build edge in turbo.json).',
        );
      }
      const target = resolve(root, 'out', 'dashboard');
      mkdirSync(target, { recursive: true });
      cpSync(dist, target, { recursive: true });
    },
  };
}

/**
 * The splash/crash pages must render with zero network AND before the server
 * exists (§2.2 step 6), so their CSS cannot be fetched — it is copied next to
 * them and `<link>`ed relatively. `@adminium/tokens` is the source of truth for
 * the custom properties (02-design-system.md); pinning a copy of the two files
 * here keeps the pages honest without giving the shell an import edge into a
 * package's internals.
 */
function copyTokenCss(): Plugin {
  return {
    name: 'adminium:copy-token-css',
    apply: 'build',
    closeBundle() {
      const require = createRequire(import.meta.url);
      const target = resolve(root, 'out', 'renderer', 'tokens');
      mkdirSync(target, { recursive: true });
      for (const file of ['tokens.css', 'fonts.css'] as const) {
        copyFileSync(require.resolve(`@adminium/tokens/${file}`), resolve(target, file));
      }
    },
  };
}

export default defineConfig({
  main: {
    build: {
      // Widened from the `out/main` default so the fourth entry can land in
      // `out/server` — see the module header.
      outDir: 'out',
      // ON (electron-vite's default, stated rather than inherited because it is
      // load-bearing here): everything in `dependencies` stays a runtime import.
      // That is what keeps @adminium/server unmodified — see the module header —
      // and it is also the only thing that CAN work for the native modules and
      // for the packages the server reaches by computed specifier.
      externalizeDeps: true,
      rollupOptions: {
        input: {
          'main/index': src('main', 'index.ts'),
          'server/index': src('server', 'index.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
        },
      },
    },
    plugins: [copyDashboardBuild()],
  },

  preload: {
    build: {
      // CJS, not ESM. §2.4 requires `sandbox: true`, and a sandboxed preload is
      // loaded by Electron's own limited `require` shim — it cannot be an ES
      // module. The `.cjs` extension states that unambiguously inside a
      // `"type": "module"` package.
      rollupOptions: {
        input: { index: src('preload', 'index.ts') },
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },

  renderer: {
    root: src('renderer'),
    build: {
      outDir: 'out/renderer',
      // No index.html here on purpose: the renderer's real document is served by
      // the embedded Fastify over loopback (§1 principle 3, "Loopback HTTP, not
      // file://"). These two are the only pages that exist before/without a
      // server (§2.2 steps 6 and 9).
      rollupOptions: {
        input: {
          boot: src('renderer', 'boot.html'),
          crash: src('renderer', 'crash.html'),
        },
      },
    },
    plugins: [copyTokenCss()],
  },
});
