// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A `pages/*.tsx` page and a `widgets/*.tsx` cell render inside the dashboard
 * with one React instance, and a broken bundle shows the error state while the
 * rest keeps working.
 *
 * Nothing here is a stand-in for the build: the files are built by the
 * server's own `buildClientCode` (read from its source, which is why this
 * file is in `scripts/check-cross-package-tests.mjs`) with the esbuild that
 * comes with this package's Vite, then imported and rendered with this app's
 * React, its UI kit and its providers. A second React would fail the page's
 * first hook; the test also compares the functions the bundle holds.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { clearAddOnRuntime } from '@adminium/add-on-contracts/runtime';
import type { PageEnvelope } from '@adminium/engine/config';
import { CellValue, gridColumnSpecSchema } from '@adminium/widgets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BootstrapData, BootstrapProject } from '../app/bootstrap.js';
import { AppToastProvider } from '../pages/toasts.js';
import { makeBootstrap } from '../test/fixtures.js';
import { forgetProjectModules, setProjectModuleImporter } from './client.js';
import { ProjectScope } from './scope.js';
import { ProjectPageBinding } from './ProjectPageBinding.js';
import { resetProjectRuntime } from './runtime.js';

interface BuiltEntry {
  name: string;
  module: string;
  imports: string[];
  styles: string[];
  kind?: 'cell' | 'card';
  title?: string | null;
}

interface ClientBuild {
  pages: BuiltEntry[];
  widgets: BuiltEntry[];
  files: { path: string; integrity: string }[];
}

type BuildClientCode = (
  root: string,
  buildDir: string,
  opts: { bundler: unknown; dev?: boolean; shims?: Record<string, string> },
) => Promise<ClientBuild>;

const PUBLIC_PATH = '/api/v1/project/client/';

// `import.meta.url` is not a file URL under happy-dom; vitest runs in the package folder.
const PACKAGE_DIR = process.cwd();

/** The server's build, from its source. A computed path keeps it out of this app's type check. */
async function serverBuild(): Promise<BuildClientCode> {
  const path = resolve(PACKAGE_DIR, '..', 'server', 'src', 'project', 'client-build.ts');
  const mod = (await import(/* @vite-ignore */ path)) as { buildClientCode: BuildClientCode };
  return mod.buildClientCode;
}

/**
 * Where the build's shims are, as the server finds them itself: the contract
 * package's runtime files, and the server's kit module. Named here because the
 * server finds them from `import.meta.url`, which happy-dom does not give.
 */
function shims(): Record<string, string> {
  const runtime = createRequire(join(PACKAGE_DIR, '..', 'server', 'package.json')).resolve(
    '@adminium/add-on-contracts/runtime',
  );
  const dir = dirname(runtime);
  return {
    react: join(dir, 'react.js'),
    jsxRuntime: join(dir, 'jsx-runtime.js'),
    compilerRuntime: join(dir, 'compiler-runtime.js'),
    reactDom: join(dir, 'react-dom.js'),
    ui: resolve(PACKAGE_DIR, '..', 'server', 'src', 'ui', 'index.ts'),
  };
}

/** The esbuild this package's Vite brings. */
async function esbuild(): Promise<unknown> {
  const vite = createRequire(join(PACKAGE_DIR, 'package.json')).resolve('vite');
  const entry = createRequire(vite).resolve('esbuild');
  return import(/* @vite-ignore */ pathToFileURL(entry).href);
}

function put(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

const SHARED = `
import { createContext, useContext } from 'react';
export const Tone = createContext('plain');
export const useTone = () => useContext(Tone);
`;

const PAGE = `
import * as ReactInBundle from 'react';
import { useEffect, useState } from 'react';
import { Card, Stat, definePage, useCurrentUser } from '@adminiumjs/adminium/ui';
import { Tone, useTone } from './_shared';

export const reactInBundle = ReactInBundle;

function Inner() {
  return <p>tone: {useTone()}</p>;
}

export default definePage({
  title: 'Revenue',
  icon: 'chart-line',
  component: function Revenue({ slug }) {
    const [count, setCount] = useState(1);
    useEffect(() => setCount(2), []);
    const user = useCurrentUser();
    return (
      <Tone.Provider value="bright">
        <Card title={'Hello ' + user.name}>
          <Stat label="Orders" value={String(count)} delta={5} />
          <p>address: {slug}</p>
          <Inner />
        </Card>
      </Tone.Provider>
    );
  },
});
`;

const CELL = `
import { useMemo } from 'react';
import { defineWidget } from '@adminiumjs/adminium/ui';

export default defineWidget({
  kind: 'cell',
  component: ({ value, record }) => {
    const label = useMemo(() => (value ? 'Flagged' : 'Clear') + ' #' + record.id, [value, record.id]);
    return <strong>{label}</strong>;
  },
});
`;

let root: string;
let build: ClientBuild;
let project: BootstrapProject;

beforeAll(async () => {
  // happy-dom would fetch every preloaded file from a server that is not there.
  const settings = (window as unknown as { happyDOM: { settings: Record<string, unknown> } }).happyDOM.settings;
  settings['disableJavaScriptFileLoading'] = true;
  settings['disableCSSFileLoading'] = true;
  settings['handleDisabledFileLoadingAsSuccess'] = true;

  // Inside this package: the module runner here imports files under its own root.
  const cache = join(PACKAGE_DIR, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, 'adminium-bundle-'));
  put(root, 'pages/_shared.tsx', SHARED);
  put(root, 'pages/revenue.tsx', PAGE);
  put(root, 'widgets/flag-cell.tsx', CELL);
  put(root, 'widgets/broken.tsx', CELL);
  const buildClientCode = await serverBuild();
  build = await buildClientCode(root, join(root, '.adminium', 'build'), { bundler: await esbuild(), shims: shims() });

  // The server serves what it built; here a broken file stands in for a bad deploy.
  const broken = build.widgets.find((widget) => widget.name === 'broken');
  if (broken === undefined) throw new Error('the broken widget was not built');
  writeFileSync(join(root, '.adminium', 'build', 'client', broken.module), 'export default {;\n');

  const integrity = new Map(build.files.map((file) => [file.path, file.integrity]));
  const ref = (path: string) => ({ url: `${PUBLIC_PATH}${path}`, integrity: integrity.get(path) ?? '' });
  const entry = (built: BuiltEntry) => ({
    module: ref(built.module),
    imports: built.imports.map(ref),
    styles: built.styles.map(ref),
  });
  project = {
    databases: { main: 'conn_main' },
    client: {
      digest: 'real',
      pages: build.pages.map((page) => ({ slug: page.name, ...entry(page) })),
      widgets: build.widgets.map((widget) => ({
        id: `project.${widget.name}`,
        kind: widget.kind ?? 'cell',
        title: widget.title ?? null,
        ...entry(widget),
      })),
    },
  };
  setProjectModuleImporter((url) => {
    const file = join(root, '.adminium', 'build', 'client', ...url.slice(PUBLIC_PATH.length).split('/'));
    return import(/* @vite-ignore */ pathToFileURL(file).href);
  });
}, 60_000);

afterAll(() => {
  forgetProjectModules();
  clearAddOnRuntime();
  resetProjectRuntime();
  rmSync(root, { recursive: true, force: true });
});

function renderInApp(ui: React.ReactNode) {
  const bootstrap: BootstrapData = makeBootstrap({ project });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['bootstrap'], bootstrap);
  return render(
    <QueryClientProvider client={queryClient}>
      <AppToastProvider>
        <ProjectScope>{ui}</ProjectScope>
      </AppToastProvider>
    </QueryClientProvider>,
  );
}

const revenue: PageEnvelope = {
  v: 1,
  kind: 'page',
  id: 'page_proj_revenue',
  template: 'project-page',
  title: { key: 'project.pages.revenue', fallback: 'Revenue' },
  source: { connectionId: null, table: null },
  nav: { group: 'workspace', icon: 'chart-line', order: 0, slug: 'revenue' },
  access: { minRole: 'viewer', permissions: [] },
  config: { file: 'revenue' },
};

const adapters = {
  crud: null,
  dashboard: null,
  onEvent: () => undefined,
  openRecord: () => undefined,
  notifyUndoable: () => undefined,
};

const flagColumn = (widget: string) => gridColumnSpecSchema.parse({ name: 'flagged', label: 'Flag', widget });

describe('a built project page and cell', () => {
  it('were built with no React of their own', () => {
    expect(build.pages.map((page) => page.name)).toEqual(['revenue']);
    expect(build.widgets.map((widget) => [widget.name, widget.kind])).toEqual([
      ['broken', 'cell'],
      ['flag-cell', 'cell'],
    ]);
  });

  it('render with the one React this dashboard runs', async () => {
    renderInApp(
      <>
        <ProjectPageBinding page={revenue} adapters={adapters} />
        <CellValue column={flagColumn('project.flag-cell')} row={{ id: 7, flagged: true }} />
      </>,
    );
    // Hooks ran (useState, useEffect, useMemo, useContext across a provider),
    // and the kit came from the dashboard: none of that works with two Reacts.
    expect(await screen.findByText('Hello Ava Reyes')).toBeTruthy();
    expect(await screen.findByText('2')).toBeTruthy();
    expect(screen.getByText('+5%')).toBeTruthy();
    expect(screen.getByText('address: revenue')).toBeTruthy();
    expect(screen.getByText('tone: bright')).toBeTruthy();
    expect(await screen.findByText('Flagged #7')).toBeTruthy();

    const page = build.pages[0] as BuiltEntry;
    const url = pathToFileURL(join(root, '.adminium', 'build', 'client', page.module)).href;
    const mod = (await import(/* @vite-ignore */ url)) as { reactInBundle: Record<string, unknown> };
    for (const name of ['useState', 'useEffect', 'useContext', 'createContext', 'createElement']) {
      expect(mod.reactInBundle[name], name).toBe((React as unknown as Record<string, unknown>)[name]);
    }
  });

  it('keep working beside a bundle that does not load', async () => {
    renderInApp(
      <>
        <CellValue column={flagColumn('project.broken')} row={{ id: 8, flagged: 'raw value' }} />
        <CellValue column={flagColumn('project.flag-cell')} row={{ id: 9, flagged: false }} />
      </>,
    );
    expect(await screen.findByText('Clear #9')).toBeTruthy();
    const undrawn = await screen.findByTestId('project-cell-undrawn');
    expect(undrawn.firstChild?.textContent).toBe('raw value');
  });
});
