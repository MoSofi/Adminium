// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two things about the app's own pages that only their SOURCE can say.
 *
 * 1. WHAT THEY MAY IMPORT. They are drawn before any server runs and ride in
 *    the app's archive: React, the kit, the tokens, the icons, the i18n package
 *    and the bridge's types. Never the dashboard, the server or a widget
 *    package: one such import would pull megabytes into a page that says fifty
 *    things, and the dependency rules do not record a renderer's imports here.
 * 2. THEIR WORDS. Every `t('desktop:…', '…')` names a key the English locale
 *    file has, with the same text byte for byte (the fallback is what a test
 *    without i18n draws), and the file has no key nothing reads.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pages = join(here, '..', 'renderer', 'app');
const locale = join(here, '..', '..', '..', '..', 'packages', 'i18n', 'locales', 'en-US', 'desktop.json');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|css)$/.test(entry) ? [path] : [];
  });
}
const files = sources(pages);
const code = files.filter((file) => !file.endsWith('.css') && !/\.test\.tsx?$/.test(file));

const ALLOWED = [/^react$/, /^react\/jsx-runtime$/, /^react-dom\/client$/, /^lucide-react$/, /^@adminium\/ui$/, /^@adminium\/tokens(\/.*)?$/, /^@adminium\/i18n(\/react|\/resources\/[a-z-]+\/(desktop|ui))?$/, /^tailwindcss$/,
  // The code a phone scans for a shared project's address: drawn on the page, from a small package with no dependencies.
  /^qr$/,
];

describe('the app’s own pages', () => {
  it('exist where the build looks for them', () => {
    expect(files.map((file) => relative(pages, file))).toContain('main.tsx');
    expect(readFileSync(join(pages, 'index.html'), 'utf8')).toContain('./main.tsx');
  });

  it('import only what they may: never the dashboard, the server or a widget package', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const named = [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|@import\s+|@source\s+)['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
      for (const specifier of named) {
        if (specifier.startsWith('.')) {
          // A relative path may reach the bridge's types and the kit's sources (for the stylesheet), and nothing else outside.
          const inside = !relative(pages, join(dirname(file), specifier)).startsWith('..');
          const bridgeTypes = /(^|\/)preload\/api\.js$/.test(specifier);
          const kitSources = file.endsWith('.css') && specifier.includes('node_modules/@adminium/ui/src/');
          if (!inside && !bridgeTypes && !kitSources) offenders.push(`${relative(pages, file)} → ${specifier}`);
          continue;
        }
        const test = /\.test\.tsx?$/.test(file);
        if (test && /^(vitest|@testing-library\/.*)$/.test(specifier)) continue;
        if (!ALLOWED.some((allowed) => allowed.test(specifier))) offenders.push(`${relative(pages, file)} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('say only what the English locale file says, and the file says nothing they do not', () => {
    const flat: Record<string, string> = {};
    const walk = (node: unknown, prefix: string): void => {
      if (typeof node === 'string') flat[prefix] = node;
      else for (const [key, child] of Object.entries(node as Record<string, unknown>)) walk(child, prefix === '' ? key : `${prefix}.${key}`);
    };
    walk(JSON.parse(readFileSync(locale, 'utf8')), '');

    const used = new Map<string, string>();
    const problems: string[] = [];
    for (const file of code) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\bt\(\s*'([\w:.]+)',\s*'((?:[^'\\]|\\.)*)'/g)) {
        const key = match[1] ?? '';
        // The fallback as the program holds it: its escapes read.
        const fallback = JSON.parse(`"${(match[2] ?? '').replace(/\\[\s\S]|"/g, (found) => (found === "\\'" ? "'" : found === '"' ? '\\"' : found))}"`) as string;
        if (!key.startsWith('desktop:')) {
          problems.push(`${relative(pages, file)}: ${key} is not a desktop: key`);
          continue;
        }
        used.set(key.slice('desktop:'.length), fallback);
      }
      // Every call is a literal key with a literal fallback: nothing built from pieces escapes the check above.
      const calls = [...text.matchAll(/\bt\(\s*[^\s')]/g)].length;
      if (calls > 0) problems.push(`${relative(pages, file)}: a t() call whose key is not a literal`);
    }
    for (const [key, fallback] of used) {
      if (!(key in flat)) problems.push(`missing from desktop.json: ${key}`);
      else if (flat[key] !== fallback) problems.push(`${key}: the page says ${JSON.stringify(fallback)}, the file ${JSON.stringify(flat[key])}`);
    }
    for (const key of Object.keys(flat)) if (!used.has(key)) problems.push(`in desktop.json and read by no page: ${key}`);
    expect(problems).toEqual([]);
    expect(used.size).toBeGreaterThan(40);
  });
});
