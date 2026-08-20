// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The catalogue fetch is memoized, and the interesting case is the one where
 * it FAILS: a rejected promise left in the cache is re-returned to every later
 * caller, so a single 404 from a stale deploy would leave every icon outside
 * the generated core set wrong for the whole session — a placeholder in this
 * package, the neutral `File` glyph in the dashboard.
 *
 * `lucide-react` is mocked with a getter rather than a throwing factory: the
 * module must still EVALUATE (the core set static-imports names from it), and
 * only the `icons` access the resolver makes inside its `.then` should blow up.
 * That is also the honest simulation — a chunk that fails to load rejects the
 * dynamic import, it does not corrupt the module registry.
 */
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Icon } from './Icon.js';
import { CORE_ICONS } from './icon-core.js';
import { loadFullIconSet, resetIconSetForTests } from './icon-resolver.js';

/** Flipped by each test; the mock reads it at `icons` access time. */
let catalogueFails = false;

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    // Later accessor wins over the spread copy above.
    get icons() {
      if (catalogueFails) throw new Error('Failed to fetch dynamically imported module');
      return actual.icons;
    },
  };
});

beforeEach(() => {
  catalogueFails = false;
});

afterEach(() => {
  resetIconSetForTests();
});

describe('loadFullIconSet', () => {
  it('retries after a failed fetch instead of re-returning the rejection', async () => {
    catalogueFails = true;
    await expect(loadFullIconSet()).rejects.toThrow(/dynamically imported module/);

    // The regression: with the failed promise still memoized this call — and
    // every call for the rest of the session — rejects too, without a fetch.
    catalogueFails = false;
    const icons = await loadFullIconSet();
    expect(icons['Anchor']).toBeDefined();
  });

  it('keeps memoizing the SUCCESSFUL load — one fetch, not one per caller', async () => {
    const [first, second] = await Promise.all([loadFullIconSet(), loadFullIconSet()]);
    expect(first).toBe(second);
  });
});

describe('an icon outside the core set, after a failed catalogue fetch', () => {
  it('holds its placeholder, then fills in when a later mount refetches', async () => {
    expect(CORE_ICONS['Anchor']).toBeUndefined();
    expect(CORE_ICONS['Aperture']).toBeUndefined();

    catalogueFails = true;
    const { container } = render(<Icon name="Anchor" />);
    // Failure is silent by design: an icon is decoration and must never take a
    // screen down. The placeholder holds the layout.
    await waitFor(() => {
      expect(container.querySelector('span')).not.toBeNull();
    });
    expect(container.querySelector('svg')).toBeNull();

    // Any later miss — a navigation, an admin opening a screen with its own
    // hand-picked icon — retries, and the icons still waiting from before the
    // failure are notified by it. One recovery heals the session.
    catalogueFails = false;
    const later = render(<Icon name="Aperture" />);
    await waitFor(() => {
      expect(later.container.querySelector('svg')).not.toBeNull();
    });
    await waitFor(() => {
      expect(container.querySelector('svg')).not.toBeNull();
    });
  });
});
