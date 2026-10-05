// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * Four screens' words, deferred.
 *
 * en-US ships the `builder`, `kb`, `about` and `team` groups of `common` as
 * their own chunk (`COMMON_DEFERRED_GROUPS`, @adminium/i18n): about 5.8 KiB gz
 * off every user's first load. What that buys, enforced:
 *
 * 1. every module that names one of their keys belongs to a screen that
 *    WAITS for the words (`useCommonWords`, ./commonWords.ts) before it
 *    renders, so its inline English never shows and then changes;
 * 2. every key named by a literal is in the catalogue;
 * 3. the server reads none of them;
 * 4. a screen that waits paints the catalogue's words — or an owner's
 *    rewording — on its first frame.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { COMMON_DEFERRED_GROUPS } from '@adminium/i18n';
import { EN_US_RESOURCES, type ResourceBundle } from '@adminium/i18n/resources';
import { act, render, screen } from '@testing-library/react';
import { Suspense, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// vitest runs with cwd = apps/dashboard.
const SRC = join(process.cwd(), 'src');
const SERVER = join(process.cwd(), '..', 'server', 'src');
const GROUPS = COMMON_DEFERRED_GROUPS.join('|');
// A key is a quoted literal; a name in backticks is prose (a comment naming a reply's field).
const KEY = new RegExp(`['"](?:common:)?((?:${GROUPS})\\.[A-Za-z0-9_.]+)['"]`, 'g');

/** The screens that wait, and the modules each one draws: a part renders only inside its screen. */
const SCREENS: Readonly<Record<string, readonly string[]>> = {
  'about/AboutPage.tsx': ['about/DesktopAboutSections.tsx'],
  'kb/KnowledgeBasePage.tsx': ['kb/articles.ts'],
  'team/TeamPage.tsx': [],
  'account/SecurityPage.tsx': [],
  'desktop/updates.tsx': [],
  'pages/builders/PageBuilderBinding.tsx': [],
  'pages/dashboard-builder/DashboardBuilder.tsx': [
    'pages/dashboard-builder/BuilderGrid.tsx',
    'pages/dashboard-builder/ConfigInspector.tsx',
    'pages/dashboard-builder/BindingEditor.tsx',
    'pages/dashboard-builder/WidgetPalette.tsx',
  ],
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\./.test(entry.name)) out.push(path);
  }
  return out;
}

const keysIn = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(KEY)].map((match) => match[1] as string);

function catalogued(key: string): unknown {
  let node: ResourceBundle[string] | undefined = EN_US_RESOURCES.common;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return node;
}

describe('the modules that read a deferred group of common', () => {
  const readers = sourceFiles(SRC)
    .filter((file) => keysIn(file).length > 0)
    .map((file) => relative(SRC, file).split('\\').join('/'))
    .sort();

  it('each belong to a screen that waits for the words', () => {
    const covered = Object.entries(SCREENS).flatMap(([root, parts]) => [root, ...parts]);
    expect(readers.filter((file) => !covered.includes(file))).toEqual([]);
    // A screen dropped from the list above would otherwise pass unseen.
    expect(readers.length).toBeGreaterThanOrEqual(12);
    expect(covered.filter((file) => !readers.includes(file))).toEqual([]);
    for (const root of Object.keys(SCREENS)) {
      const text = readFileSync(join(SRC, root), 'utf8');
      expect(text.includes("import { useCommonWords } from '"), root).toBe(true);
      expect(/\n {2}useCommonWords\(\);\n/.test(text), root).toBe(true);
    }
  });

  it('a part is drawn by its screen and nothing else', () => {
    for (const [root, parts] of Object.entries(SCREENS)) {
      for (const part of parts) {
        const name = (part.split('/').pop() as string).replace(/\.tsx?$/, '');
        const importers = sourceFiles(SRC)
          .filter((file) => new RegExp(`from '[^']*/${name}\\.js'`).test(readFileSync(file, 'utf8')))
          .map((file) => relative(SRC, file).split('\\').join('/'));
        const family = [root, ...parts];
        // Every importer is the screen, one of its parts, or a module of the same folder that the screen draws.
        const strangers = importers.filter((file) => !family.includes(file) && !family.some((member) => member.split('/').slice(0, -1).join('/') === file.split('/').slice(0, -1).join('/')));
        expect(strangers, `${part} is imported outside ${root}`).toEqual([]);
      }
    }
  });

  it('name only keys the catalogue has', () => {
    const missing = sourceFiles(SRC).flatMap((file) => keysIn(file).filter((key) => catalogued(key) === undefined).map((key) => `${relative(SRC, file)}: ${key}`));
    expect(missing).toEqual([]);
  });

  it('are never the server\'s', () => {
    expect(sourceFiles(SERVER).filter((file) => keysIn(file).some((key) => catalogued(key) !== undefined)).map((file) => relative(SERVER, file))).toEqual([]);
  });
});

describe('a screen that waits', () => {
  afterEach(() => vi.resetModules());

  const SAMPLES = [
    ['about.title', 'About Adminium'],
    ['kb.title', 'Knowledge Base'],
    ['builder.view', 'View'],
  ] as const;

  async function mount(prepare?: (i18n: { addResources(tag: string, ns: string, flat: Record<string, string>): unknown }) => void) {
    vi.resetModules();
    const { createI18n, hasWords } = await import('@adminium/i18n');
    const { setI18nInstance, t } = await import('./t.js');
    const { useCommonWords, commonWordsReady } = await import('./commonWords.js');
    const i18n = await createI18n({ locale: 'en_US' });
    prepare?.(i18n);
    setI18nInstance(i18n);
    expect(hasWords(i18n, 'common')).toBe(false);
    const painted: string[] = [];
    function Screen(): ReactNode {
      useCommonWords();
      const texts = SAMPLES.map(([key]) => t(key, `inline ${key}`));
      painted.push(...texts);
      return <p data-testid="screen">{texts.join(' | ')}</p>;
    }
    await act(async () => {
      render(
        <Suspense fallback={<p data-testid="waiting" />}>
          <Screen />
        </Suspense>,
      );
    });
    const text = (await screen.findByTestId('screen')).textContent;
    await commonWordsReady();
    setI18nInstance(null);
    return { text, painted };
  }

  it('paints the catalogue\'s words on its first frame, never its inline English', async () => {
    const { text, painted } = await mount();
    expect(text).toBe(SAMPLES.map(([, words]) => words).join(' | '));
    expect(painted.some((words) => words.startsWith('inline '))).toBe(false);
  });

  it('paints an owner\'s rewording, applied before the words were read', async () => {
    const { text, painted } = await mount((i18n) => i18n.addResources('en-US', 'common', { 'about.title': 'About this desk' }));
    expect(text).toBe('About this desk | Knowledge Base | View');
    expect(painted.some((words) => words.startsWith('inline '))).toBe(false);
  });

  it('with no instance at all there is nothing to wait for', async () => {
    vi.resetModules();
    const { useCommonWords, commonWordsReady } = await import('./commonWords.js');
    await expect(commonWordsReady()).resolves.toBeUndefined();
    function Screen(): ReactNode {
      useCommonWords();
      return <p data-testid="bare">ready</p>;
    }
    render(<Screen />);
    expect(screen.getByTestId('bare').textContent).toBe('ready');
  });
});
