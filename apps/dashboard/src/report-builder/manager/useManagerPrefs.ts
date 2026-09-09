// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The manager's one view preference — gallery or list — kept in
 * `localStorage` so it survives a reload (43-report-builder.md Appendix A S4,
 * M6; the invoice surface's hook under its own key). It is a convenience of
 * one browser, not workspace state: nothing about a report changes when
 * someone prefers the list, so it never touches the server.
 *
 * ONE preference, not two: this comp draws no group segment (M7 — the
 * grouping the invoice manager has is absent here, 43 §5 item 3).
 *
 * Every storage access is wrapped: a private window, a full quota or a
 * locked-down embed throws on `localStorage` itself, and the page must render
 * with the default rather than not at all.
 */
import { useCallback, useState } from 'react';

export type ManagerLayout = 'gallery' | 'list';

export interface ManagerPrefs {
  layout: ManagerLayout;
}

export const MANAGER_PREFS_KEY = 'adminium-report-builder-manager';

/** The comp's initial state (437, 448): gallery. */
export const DEFAULT_MANAGER_PREFS: ManagerPrefs = { layout: 'gallery' };

const LAYOUTS: readonly ManagerLayout[] = ['gallery', 'list'];

function isLayout(value: unknown): value is ManagerLayout {
  return typeof value === 'string' && (LAYOUTS as readonly string[]).includes(value);
}

/** What the browser remembers, validated field by field; anything odd falls back to the default. */
export function readManagerPrefs(): ManagerPrefs {
  try {
    const raw = window.localStorage.getItem(MANAGER_PREFS_KEY);
    if (raw === null) return DEFAULT_MANAGER_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_MANAGER_PREFS;
    const record = parsed as Record<string, unknown>;
    return { layout: isLayout(record['layout']) ? record['layout'] : DEFAULT_MANAGER_PREFS.layout };
  } catch {
    return DEFAULT_MANAGER_PREFS;
  }
}

export function writeManagerPrefs(prefs: ManagerPrefs): void {
  try {
    window.localStorage.setItem(MANAGER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable — the choice still applies for this page's lifetime.
  }
}

/** `[prefs, update]` — `update` merges a partial and persists the result. */
export function useManagerPrefs(): [ManagerPrefs, (patch: Partial<ManagerPrefs>) => void] {
  const [prefs, setPrefs] = useState<ManagerPrefs>(readManagerPrefs);
  const update = useCallback((patch: Partial<ManagerPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      writeManagerPrefs(next);
      return next;
    });
  }, []);
  return [prefs, update];
}
