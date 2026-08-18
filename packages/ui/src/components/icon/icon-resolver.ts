// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Resolving a lucide icon from a RUNTIME NAME, without shipping all 1,611.
 *
 * ─── The problem ─────────────────────────────────────────────────────────────
 *
 * Two call sites resolve an icon from a string: this package's `Icon` (`name`
 * is part of its API) and the dashboard's `lucideByName` (nav rows, table
 * overrides and LLM run summaries all carry an admin-chosen kebab name). Both
 * did it with `import { icons } from 'lucide-react'`, and a map lookup is
 * opaque to a bundler — so all 1,611 icon modules landed in the dashboard's
 * ENTRY chunk. Measured by stubbing the two imports and rebuilding: **112.6 KiB
 * gzipped**, 20% of the entry, for the 99 icons the product draws.
 *
 * `sideEffects: false` cannot help. Nothing is wrong with the package; the
 * import genuinely asks for the whole object.
 *
 * ─── The split ───────────────────────────────────────────────────────────────
 *
 * `icon-core.ts` (generated) statically imports the icons the product itself
 * renders, BY NAME, so the bundler shakes the rest. Everything else — an icon an
 * admin found by searching the full catalogue in the page-icon picker — misses
 * that set and comes from {@link loadFullIconSet}, a dynamic import that becomes
 * its own chunk. The cost moves from every cold boot onto the first render of a
 * page whose icon was hand-picked, and nothing becomes unreachable.
 *
 * ─── Why a subscription and not Suspense ─────────────────────────────────────
 *
 * An icon is a leaf inside dense chrome — a sidebar row, a tree node, a table
 * cell. Suspending any of those would blank a region far larger than the glyph.
 * So a miss renders a same-sized placeholder, the load runs once for the whole
 * app, and every waiting icon re-renders when it lands.
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

import { CORE_ICONS } from './icon-core.js';

export type { LucideIcon };

/** `bar-chart-3` → `BarChart3` — lucide's `icons` map is keyed PascalCase. */
export function pascalCaseIconName(kebab: string): string {
  return kebab
    .split('-')
    .map((part) => (part.length === 0 ? part : (part[0] as string).toUpperCase() + part.slice(1)))
    .join('');
}

let fullSet: Record<string, LucideIcon> | null = null;
let pending: Promise<Record<string, LucideIcon>> | null = null;
const waiters = new Set<() => void>();

/**
 * The whole lucide catalogue, fetched once. Exported so the icon PICKERS — which
 * legitimately need every name to search — can await it explicitly rather than
 * static-importing the map back into their chunk.
 */
export async function loadFullIconSet(): Promise<Record<string, LucideIcon>> {
  if (fullSet !== null) return fullSet;
  pending ??= import('lucide-react').then((module) => {
    fullSet = module.icons as unknown as Record<string, LucideIcon>;
    for (const notify of waiters) notify();
    waiters.clear();
    return fullSet;
  });
  return await pending;
}

/** Already resolvable without a network round trip? */
export function resolveIconSync(name: string): LucideIcon | undefined {
  return CORE_ICONS[name] ?? fullSet?.[name];
}

/**
 * The icon for `name` (PascalCase), or `undefined` while the full catalogue is
 * still loading. Triggers that load on a miss.
 */
export function useLucideIcon(name: string): LucideIcon | undefined {
  const [, bump] = useState(0);
  const resolved = resolveIconSync(name);

  useEffect(() => {
    if (resolved !== undefined) return;
    let alive = true;
    const notify = (): void => {
      if (alive) bump((n) => n + 1);
    };
    waiters.add(notify);
    void loadFullIconSet().then(notify, () => {
      // A failed chunk leaves the placeholder. An icon is decoration; it must
      // never take a screen down with it.
    });
    return () => {
      alive = false;
      waiters.delete(notify);
    };
  }, [name, resolved]);

  return resolved;
}

/** Test seam — the module-level cache would otherwise leak between suites. */
export function resetIconSetForTests(): void {
  fullSet = null;
  pending = null;
  waiters.clear();
}
