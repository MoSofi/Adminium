// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page gutter (02-design-system.md §1.8): `PageSurface` is the only thing
 * in the app allowed to set the inner main section's padding, so these pin the
 * three shared choices, the per-page override, and — the point of the whole
 * exercise — that the choice set stays CLOSED. A page that invents its own
 * `p-8` is the bug this component exists to prevent.
 */
import { render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PageSurface, resolvePagePadding } from './PageSurface.js';

function surfaceOf(): HTMLElement {
  return screen.getByTestId('subject');
}

describe('PageSurface', () => {
  it('defaults to the standard gutter — consistency for doing nothing', () => {
    render(<PageSurface testId="subject">x</PageSurface>);
    expect(surfaceOf().className).toContain('p-[var(--main-pad)]');
    expect(surfaceOf().getAttribute('data-padding')).toBe('standard');
  });

  it('applies no padding class at all for `none`', () => {
    render(
      <PageSurface padding="none" testId="subject">
        x
      </PageSurface>,
    );
    expect(surfaceOf().className).not.toContain('p-[var(--main-pad)]');
    expect(surfaceOf().getAttribute('data-padding')).toBe('none');
  });

  it('writes an explicit x/y pair onto a custom property, y first', () => {
    render(
      <PageSurface padding={{ x: 40, y: 12 }} testId="subject">
        x
      </PageSurface>,
    );
    // The pair rides a custom property a literal utility reads: Tailwind
    // generates from source text, and these numbers only exist at runtime.
    expect(surfaceOf().style.getPropertyValue('--adm-page-pad')).toBe('12px 40px');
    expect(surfaceOf().className).toContain('p-[var(--adm-page-pad)]');
    expect(surfaceOf().className).not.toContain('p-[var(--main-pad)]');
    expect(surfaceOf().getAttribute('data-padding')).toBe('custom');
  });

  it('centres a capped column only when a width is chosen', () => {
    const { rerender } = render(<PageSurface testId="subject">x</PageSurface>);
    expect(surfaceOf().className).not.toContain('mx-auto');

    rerender(
      <PageSurface width="content" testId="subject">
        x
      </PageSurface>,
    );
    expect(surfaceOf().className).toContain('mx-auto');
    expect(surfaceOf().className).toContain('max-w-content');
  });

  it('only takes the h-full chain when the template asks to fill', () => {
    const { rerender } = render(<PageSurface testId="subject">x</PageSurface>);
    expect(surfaceOf().className).not.toContain('h-full');

    rerender(
      <PageSurface fill testId="subject">
        x
      </PageSurface>,
    );
    expect(surfaceOf().className).toContain('h-full');
  });
});

describe('resolvePagePadding', () => {
  it('falls back to the template default when nothing is stored', () => {
    expect(resolvePagePadding(undefined, 'none')).toBe('none');
    expect(resolvePagePadding(null, 'standard')).toBe('standard');
  });

  it('honours a stored named choice over the template default', () => {
    expect(resolvePagePadding('none', 'standard')).toBe('none');
    expect(resolvePagePadding('standard', 'none')).toBe('standard');
  });

  it('honours a stored pair', () => {
    expect(resolvePagePadding({ x: 8, y: 4 }, 'standard')).toEqual({ x: 8, y: 4 });
  });

  it('rejects malformed or negative stored values rather than rendering them', () => {
    // A hand-edited or future-version document must degrade to the template
    // default, never to a broken layout (09 §3.1 never-crash).
    for (const bad of ['huge', 42, {}, { x: 8 }, { x: '8', y: 4 }, { x: -1, y: 4 }, { x: 8, y: Number.NaN }]) {
      expect(resolvePagePadding(bad, 'standard')).toBe('standard');
    }
  });
});

/**
 * The guard that keeps this from decaying back into what it replaced. Every
 * routed screen must get its gutter from `PageSurface`; a page that hand-rolls
 * `p-6` on its own outermost element is exactly the inconsistency this fixed.
 *
 * Scoped to the OUTERMOST element only — inner cards, rails and toolbars use
 * padding utilities freely and always will.
 */
describe('no page hand-rolls its own outer gutter', () => {
  // vitest runs this suite in happy-dom, where `import.meta.url` is not a
  // file: URL; the runner's cwd is the package root, which is stable enough.
  const srcDir = join(process.cwd(), 'src');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (entry.endsWith('.tsx') && !entry.includes('.test.')) out.push(full);
    }
    return out;
  }

  it('leaves `--main-pad` with exactly one consumer', () => {
    const offenders = walk(srcDir)
      .filter((file) => !file.endsWith('PageSurface.tsx'))
      .filter((file) => readFileSync(file, 'utf8').includes('p-[var(--main-pad)]'))
      .map((file) => file.slice(srcDir.length));

    // The token is the gutter. If anything but PageSurface reads it, two
    // components decide the same padding and they will drift.
    expect(offenders).toEqual([]);
  });
});
