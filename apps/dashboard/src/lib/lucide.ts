// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Nav rows carry lucide icon names in kebab-case (`bar-chart-3`); resolve them
 * to components, falling back to a neutral file glyph so an unknown name can
 * never crash the sidebar (09-generated-app.md §2.2).
 *
 * WHY THIS IS NOT `icons[name]` ANY MORE. It was, and because this module is on
 * the boot path (SidebarNav renders every nav row), that single map import put
 * all 1,611 lucide icon modules into the dashboard's entry chunk — 112.6 KiB
 * gzipped, measured, for the 99 the product draws. `@adminium/ui`'s
 * `icon-resolver` now owns the split: a statically-imported core set, and the
 * full catalogue behind a dynamic import for names outside it.
 *
 * The SIGNATURE is unchanged — callers still get a component they can render
 * with lucide props — because the async part is inside the returned component,
 * not around it. Components are memoized per name: returning a fresh identity
 * per call would remount the icon on every parent render, which for a sidebar
 * means every navigation.
 */
import { createElement } from 'react';
import { File } from 'lucide-react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { pascalCaseIconName, useLucideIcon } from '@adminium/ui';

const memo = new Map<string, LucideIcon>();

export function lucideByName(name: string): LucideIcon {
  const pascal = pascalCaseIconName(name);
  const cached = memo.get(pascal);
  if (cached !== undefined) return cached;

  function ResolvedIcon(props: LucideProps) {
    const glyph = useLucideIcon(pascal);
    // Unknown name, or the catalogue is still in flight — the neutral glyph is
    // the same answer the old map lookup gave for an unknown name, and it keeps
    // the row's layout stable while a hand-picked icon loads. `createElement`
    // rather than JSX so this module stays a `.ts` its callers already import.
    return createElement(glyph ?? File, props);
  }
  ResolvedIcon.displayName = `LucideByName(${pascal})`;

  const component = ResolvedIcon as unknown as LucideIcon;
  memo.set(pascal, component);
  return component;
}
