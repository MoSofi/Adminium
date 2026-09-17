// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The manager's two view preferences — gallery/list and the group-by — kept
 * in `localStorage` so they survive a reload (the email
 * surface's hook under its own key). They are conveniences of one browser,
 * not workspace state: nothing about a template changes when someone prefers
 * the list, so they never touch the server.
 *
 * Every storage access is wrapped: a private window, a full quota or a
 * locked-down embed throws on `localStorage` itself, and the page must render
 * with the defaults rather than not at all.
 */
import { useCallback, useState } from 'react';

export type ManagerLayout = 'gallery' | 'list';
export type ManagerGroupBy = 'none' | 'topic' | 'language';

export interface ManagerPrefs {
  layout: ManagerLayout;
  groupBy: ManagerGroupBy;
}

export const MANAGER_PREFS_KEY = 'adminium-invoices-manager';

/** The comp's initial state (1044, 1049): gallery, ungrouped. */
export const DEFAULT_MANAGER_PREFS: ManagerPrefs = { layout: 'gallery', groupBy: 'none' };

const LAYOUTS: readonly ManagerLayout[] = ['gallery', 'list'];
const GROUP_BYS: readonly ManagerGroupBy[] = ['none', 'topic', 'language'];

function isLayout(value: unknown): value is ManagerLayout {
  return typeof value === 'string' && (LAYOUTS as readonly string[]).includes(value);
}

function isGroupBy(value: unknown): value is ManagerGroupBy {
  return typeof value === 'string' && (GROUP_BYS as readonly string[]).includes(value);
}

/** What the browser remembers, validated field by field; anything odd falls back to the default. */
export function readManagerPrefs(): ManagerPrefs {
  try {
    const raw = window.localStorage.getItem(MANAGER_PREFS_KEY);
    if (raw === null) return DEFAULT_MANAGER_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_MANAGER_PREFS;
    const record = parsed as Record<string, unknown>;
    return {
      layout: isLayout(record['layout']) ? record['layout'] : DEFAULT_MANAGER_PREFS.layout,
      groupBy: isGroupBy(record['groupBy']) ? record['groupBy'] : DEFAULT_MANAGER_PREFS.groupBy,
    };
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
