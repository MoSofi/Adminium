// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A source guard against ONE bug class, because it shipped once here.
 *
 * The inspector's repeater rows build a fixed-width input from a shared base:
 * `FIELD` (which carries `w-full`) plus an override like `w-[72px]`. Written as
 * a TEMPLATE LITERAL both classes survive into the DOM, and which one wins is
 * decided by the order Tailwind emits them in the stylesheet — not by the order
 * in the attribute. `w-full` won, so every `w-[72px]` / `w-16` / `w-20` input in
 * the inspector rendered at 100 % of its row and nine of the 25 panels scrolled
 * sideways (the KPI and multi-currency panels by 311 px).
 *
 * `cn()` is tailwind-merge: it drops the losing width and the override wins.
 * The rule is therefore "never concatenate class strings by hand" — and this
 * test is the rule, because the failure is invisible in review (the class list
 * reads correctly) and invisible to a jsdom test (no layout).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SURFACE = join(process.cwd(), 'src', 'report-builder');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(path);
  }
  return out;
}

/** `className={`…${SOMETHING}…`}` — a template literal used to build a class list. */
const INTERPOLATED_CLASS = /className=\{`[^`]*\$\{/g;

describe('class strings are merged, never concatenated', () => {
  it('no className is built from a template literal that interpolates another class string', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SURFACE)) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(INTERPOLATED_CLASS)) {
        const line = src.slice(0, match.index).split('\n').length;
        offenders.push(`${file.replace(process.cwd(), '.')}:${String(line)} — ${match[0].trim()}`);
      }
    }
    expect(
      offenders,
      'use cn(BASE, "override") — a template literal keeps both widths and the one that wins is ' +
        `decided by stylesheet order, not by you:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
