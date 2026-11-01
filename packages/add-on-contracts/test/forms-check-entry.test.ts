// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The answer's check as an entry of its own (`./forms/check`): a stranger's
 * page checks answers with it in the browser, so it reaches no schema and no
 * zod, only the values it shares with them (`scales.ts`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as check from '../src/forms/check.js';
import { FORM_FILES_MAX, SCALE_OF, keepsNames } from '../src/forms/index.js';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'forms');

/** Every module a file imports for its values (a type import is erased), followed through. */
function valueImports(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = readFileSync(join(src, file), 'utf8');
  for (const found of text.matchAll(/^import (?!type )[^;]*? from '([^']+)';/gm)) {
    const target = found[1]!;
    if (target.startsWith('./')) valueImports(target.slice(2).replace(/\.js$/, '.ts'), seen);
    else seen.add(target);
  }
  return seen;
}

describe('the answer check’s own entry', () => {
  it('reaches no schema and no zod', () => {
    expect([...valueImports('check.ts')].sort()).toEqual(['check.ts', 'scales.ts']);
  });

  it('is published as ./forms/check, and shares its values with the vocabulary', () => {
    const pkg = JSON.parse(readFileSync(join(src, '..', '..', 'package.json'), 'utf8')) as { exports: Record<string, { default: string }> };
    expect(pkg.exports['./forms/check']?.default).toBe('./dist/forms/check.js');
    expect(typeof check.checkAnswer).toBe('function');
    expect(typeof check.visibleQuestions).toBe('function');
    expect(FORM_FILES_MAX).toBe(5);
    expect(SCALE_OF.stars).toEqual({ min: 1, max: 5 });
    expect(keepsNames({ survey: { mode: 'anonymous', linkNames: false, stopAfterDays: 30 } })).toBe(false);
  });
});
