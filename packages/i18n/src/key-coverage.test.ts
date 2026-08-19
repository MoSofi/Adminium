// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Product-source ↔ bundle coverage gate (10-i18n-theming.md §3.5).
 *
 * `t(key, fallback)` renders `fallback` when `key` is in no bundle, so a key
 * that was never authored looks perfect in English and renders that same
 * English in all 8 locales. Nothing else in the repo can see it:
 *
 * - `resources/parity.test.ts` compares bundle to BUNDLE. It stays green when
 *   every locale equally lacks a key — "parity of absence".
 * - `adminium/no-dynamic-i18n-key` and `adminium/no-literal-strings` check the
 *   SHAPE of a call site, never whether the key exists.
 * - the Translations editor (23 §6.3) refuses to write a key that is not in
 *   the compiled bundle, so an admin cannot repair one from inside the product
 *   either — which is how `/settings/translations` came to draw its own chrome
 *   from 56 keys that no locale carried.
 *
 * So this suite is the only place the question "does the bundle actually cover
 * the product?" gets asked. It parses every product source file with the
 * TypeScript AST (not a regex — a key can sit under a prettier line wrap, and
 * `t()`'s SECOND argument is sometimes a backtick template, which is exactly
 * the shape a naive scan trips over) and resolves each literal key through
 * `sourceMessage()`, the same resolver the server validates writes with.
 *
 * Scope note: `apps/desktop/src/main` is deliberately absent, for the same
 * reason it is absent from `scripts/gen-a11y-keys.mjs` — the Electron main
 * process has its OWN translator (`menu.ts`'s `opts.t ?? defaultTranslate`)
 * over a separate key space the SPA pushes to it, so its `t('file')` calls are
 * not bundle keys. Keep the two lists in step.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { sourceMessage } from './keys.js';
import { NAMESPACES } from './resources/index.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

/**
 * Source trees whose `t()` calls resolve against these bundles, each with the
 * number of call sites below which the scan is presumed BROKEN rather than the
 * product presumed untranslated. Two of them are legitimately zero and say so
 * out loud, because a floor of zero is otherwise indistinguishable from a scan
 * that quietly stopped finding anything:
 *
 * - `packages/ui/src` has 150+ modules and no `t()` at all by contract — every
 *   string there arrives as a prop (03-component-library.md §1, 10 §2.7).
 * - `apps/desktop/src/renderer` is two static HTML shells today and holds no
 *   TypeScript; it is listed so the first renderer component written there is
 *   covered on the day it lands.
 *
 * Raise a floor when a tree grows; never lower one to make a run green.
 */
const ROOTS = [
  { path: 'apps/dashboard/src', minKeyUses: 1_500 },
  { path: 'apps/desktop/src/renderer', minKeyUses: 0 },
  { path: 'packages/ui/src', minKeyUses: 0 },
  { path: 'packages/widgets/src', minKeyUses: 500 },
  { path: 'packages/charts/src', minKeyUses: 5 },
] as const;

/**
 * Call targets treated as translators — the same set
 * `adminium/no-dynamic-i18n-key` guards, minus `useT` (a hook that takes no
 * key). A property access is included so `i18n.t('key')` counts too.
 */
const TRANSLATORS = new Set(['t', 'tOr']);

interface KeyUse {
  /** The key exactly as written, `ns:` prefix included when there is one. */
  raw: string;
  /** `path/to/file.tsx:12`, for the failure message. */
  site: string;
}

function* sourceFiles(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // A missing root is reported by the existsSync check below, not swallowed.
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      yield* sourceFiles(full);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

/** Every literal key passed to a translator in `file`. */
function keysIn(file: string): KeyUse[] {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: KeyUse[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)
          ? callee.name.text
          : null;
      const arg = node.arguments[0];
      // A non-literal key (`t(KEYS[op])`) is the type checker's job, not this
      // gate's: lint already bans FABRICATING one, and an indexed lookup into a
      // const map of literal keys is the sanctioned way to write a dynamic call
      // (10 §2.5). Only literals can be resolved here.
      if (
        name !== null &&
        TRANSLATORS.has(name) &&
        arg !== undefined &&
        (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        out.push({ raw: arg.text, site: `${relative(repoRoot, file)}:${line + 1}` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** `ui:action.save` → `['ui', 'action.save']`; a bare key resolves in `common` (createI18n's defaultNS). */
function split(raw: string): [namespace: string, key: string] {
  const colon = raw.indexOf(':');
  return colon === -1 ? ['common', raw] : [raw.slice(0, colon), raw.slice(colon + 1)];
}

const perRoot = new Map<string, KeyUse[]>();
for (const root of ROOTS) {
  const uses: KeyUse[] = [];
  for (const file of sourceFiles(join(repoRoot, root.path))) uses.push(...keysIn(file));
  perRoot.set(root.path, uses);
}
const allUses = [...perRoot.values()].flat();

describe('every t() key used in product source exists in the compiled bundle', () => {
  it('the scan reaches every product tree (AST/path sanity)', () => {
    // A collapsed count means the scan broke — a renamed directory, a changed
    // call shape, a parser that silently returned nothing — not that the
    // product stopped translating. Fail loudly rather than pass vacuously.
    for (const root of ROOTS) {
      expect(
        existsSync(join(repoRoot, root.path)),
        `${root.path} is not on disk — the scan silently covered nothing`,
      ).toBe(true);
      expect(
        (perRoot.get(root.path) ?? []).length,
        `${root.path} yielded too few t() keys — did the tree move or the call shape change?`,
      ).toBeGreaterThanOrEqual(root.minKeyUses);
    }
    expect(allUses.length).toBeGreaterThan(2_500);
  });

  it('every key resolves to a real message in en-US', () => {
    const sites = new Map<string, string[]>();
    for (const use of allUses) {
      const [namespace, key] = split(use.raw);
      if (NAMESPACES.includes(namespace as (typeof NAMESPACES)[number]) && sourceMessage(namespace, key) !== null) {
        continue;
      }
      sites.set(use.raw, [...(sites.get(use.raw) ?? []), use.site]);
    }
    const missing = [...sites.entries()].sort(([a], [b]) => a.localeCompare(b));
    expect(
      missing.map(([raw]) => raw),
      'These keys render their hardcoded English fallback in ALL 8 locales, and the ' +
        'Translations editor refuses to override a key that is not in the bundle. ' +
        'Author them in packages/i18n/locales/*/common.json (all 8), then run ' +
        '`pnpm --filter @adminium/i18n gen:resources`:\n' +
        missing.map(([raw, at]) => `  ${raw}  ← ${at.join(', ')}`).join('\n'),
    ).toEqual([]);
  });

  it('no key names a namespace that does not exist', () => {
    // `t('uix:action.save')` resolves to nothing and renders the fallback, the
    // same failure with a different cause — worth naming separately so the
    // message points at the prefix rather than at the key.
    const bad = allUses
      .filter((use) => use.raw.includes(':'))
      .filter((use) => !NAMESPACES.includes(split(use.raw)[0] as (typeof NAMESPACES)[number]))
      .map((use) => `${use.raw} (${use.site})`);
    expect(bad, `valid namespaces: ${NAMESPACES.join(', ')}`).toEqual([]);
  });
});
