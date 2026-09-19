// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Does an add-on page bundle, BUILT THE WAY A REAL ONE IS BUILT, actually reach
 * the host through the shims? (51d)
 *
 * Every other test of this contract asserts types and lists. This one runs
 * Vite over a fixture page, reads the built output, and imports it — because
 * the failure mode being guarded against is not a type error. It is a build
 * config that quietly bundles React (or react-query, or the router) into the
 * add-on, which typechecks perfectly and renders a blank screen at runtime with
 * nothing in the console.
 *
 * **The config below is the recipe an add-on package copies.** Two halves, and
 * both are load-bearing: `resolve.alias` points the real specifiers at the
 * shims, and `rollupOptions.external` keeps the shims themselves out of the
 * bundle so the host's copy is what runs. Alias without external inlines the
 * shim, which then reads the global at the WRONG time; external without alias
 * leaves a bare `react` import a browser cannot resolve.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureAddOnRuntime } from './runtime.js';

/** What an add-on's `vite.config` must say, as data so a test can assert it. */
const SHIM = '@adminium/add-on-contracts/runtime';
const ALIASES: Record<string, string> = {
  react: `${SHIM}/react`,
  'react/jsx-runtime': `${SHIM}/jsx-runtime`,
  'react-dom': `${SHIM}/react-dom`,
  '@adminium/ui': `${SHIM}/ui`,
  '@tanstack/react-router': `${SHIM}/router`,
  '@tanstack/react-query': `${SHIM}/query`,
  '@adminium/i18n': `${SHIM}/i18n`,
  '@adminium/add-on-sdk': `${SHIM}/app`,
};

const FIXTURE = `
import { Button } from '@adminium/ui';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { t, api } from '@adminium/add-on-sdk';

export default function Page() {
  return { Button, useNavigate, useQuery, t, api };
}
`;

/*
 * INSIDE the project, under the gitignored `dist/`, and not in the OS temp
 * directory — because the built file has to be IMPORTED, and vitest's module
 * runner refuses a path outside the root ("Failed to load url"). Escaping it
 * with `new Function('return import(u)')` does not work either: the runner's
 * vm context has no dynamic-import callback. So the bundle is built where the
 * runner can already see it, and removed afterwards.
 */
const WORKROOT = resolve(__dirname, '../../dist');
let built: string | null = null;

afterEach(async () => {
  if (built !== null) await rm(built, { recursive: true, force: true });
  built = null;
});

async function buildFixture(): Promise<{ code: string; file: string }> {
  const dir = join(WORKROOT, `.add-on-bundle-${randomBytes(4).toString('hex')}`);
  built = dir;
  await mkdir(dir, { recursive: true });
  const entry = join(dir, 'page.jsx');
  await writeFile(entry, FIXTURE, 'utf8');

  const { build } = await import('vite');
  await build({
    root: dir,
    logLevel: 'silent',
    resolve: { alias: ALIASES },
    build: {
      outDir: join(dir, 'out'),
      // Never `true`: this writes inside the dashboard's own `dist/`, and
      // emptying it would delete a real build somebody else was holding.
      emptyOutDir: false,
      minify: false,
      lib: { entry, formats: ['es'], fileName: 'page' },
      rollupOptions: { external: (id: string) => id.startsWith(SHIM) },
    },
  });

  // `lib.fileName` is a BASE: vite appends the format's extension, and which
  // one depends on the nearest package.json's `type`. Reading the directory is
  // the answer that does not depend on guessing it.
  const names = (await readdir(join(dir, 'out'))).filter(
    (name) => name.endsWith('.js') || name.endsWith('.mjs'),
  );
  const file = join(dir, 'out', names[0] ?? 'page.js');
  return { code: await readFile(file, 'utf8'), file };
}

describe('an add-on page bundle', () => {
  it('imports the host through the shims and bundles none of it', { timeout: 60_000 }, async () => {
    const { code, file } = await buildFixture();

    // Every import the bundle makes is a shim. Nothing else may be in there:
    // a second React is two reconcilers over one DOM tree, and a second
    // react-query is a second cache behind an empty provider.
    const imports = [...code.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1] ?? '');
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(specifier.startsWith(SHIM)).toBe(true);
    expect(imports).toContain(`${SHIM}/ui`);
    expect(imports).toContain(`${SHIM}/app`);

    // And the values it receives are the HOST's, not copies. The runtime has
    // to be installed before the import, which is the ordering rule the whole
    // contract rests on.
    await ensureAddOnRuntime();
    const mod = (await import(/* @vite-ignore */ file)) as {
      default: () => Record<string, unknown>;
    };
    const used = mod.default();

    const ui = await import('@adminium/ui');
    const router = await import('@tanstack/react-router');
    const sdk = await import('../i18n/t.js');
    expect(used['Button']).toBe(ui.Button);
    expect(used['useNavigate']).toBe(router.useNavigate);
    expect(used['t']).toBe(sdk.t);
  });

  it('names every specifier an add-on has to alias', () => {
    // The list is the recipe. A specifier missing from an add-on's config is
    // not an error at build time — it is a second copy in the output.
    expect(Object.keys(ALIASES).sort()).toEqual([
      '@adminium/add-on-sdk',
      '@adminium/i18n',
      '@adminium/ui',
      '@tanstack/react-query',
      '@tanstack/react-router',
      'react',
      'react-dom',
      'react/jsx-runtime',
    ]);
  });
});
