// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The tab's current workspace.
 *
 * Each tab keeps its own, in `sessionStorage`, KEYED BY THE PERSON: a tab
 * outlives a sign-out, and the next person to sign in there must not start
 * in the last one's workspace. It is checked against the groups the
 * bootstrap lists on every read, so a workspace that went (or that this
 * person no longer sees) is never where they are.
 *
 * The server keeps the person's last choice (`PATCH /me/prefs`) only as the
 * start for a NEW tab. Lists are filtered by what this tab sends, never by
 * that stored choice.
 *
 * One small store rather than React state: the rail (twice, as the rail and
 * as the phone drawer), the lists and the link rule all read it, and a
 * switch made in one must be the switch every other one draws.
 */
import { useSyncExternalStore } from 'react';

import { api } from '../../app/api.js';
import type { BootstrapData } from '../../app/bootstrap.js';
import { OTHER_GROUP, resolveGroup, workspaceGroups, type WorkspaceGroup } from './model.js';

const listeners = new Set<() => void>();
/** What this tab chose, per person: the fallback when storage is not there (a private window, a test). */
const memory = new Map<string, string>();

function key(userId: string): string {
  return `adminium-workspace:${userId}`;
}

function read(userId: string): string | null {
  try {
    const stored = window.sessionStorage.getItem(key(userId));
    if (stored !== null) return stored;
  } catch {
    // Storage refused: the in-memory choice below stands in.
  }
  return memory.get(userId) ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Make `groupId` the tab's group. `remember` also stores it as the person's
 * last choice on the server, where their next new tab starts: a choice the
 * person made, never one the link rule made for them.
 */
export function chooseGroup(userId: string, groupId: string, options: { remember?: boolean } = {}): void {
  memory.set(userId, groupId);
  try {
    window.sessionStorage.setItem(key(userId), groupId);
  } catch {
    // The in-memory choice holds for this page's life.
  }
  for (const listener of listeners) listener();
  if (options.remember === true) {
    // "Other databases" is no workspace: the stored start goes back to the first one.
    void api.patch('/api/v1/me/prefs', { workspaceId: groupId === OTHER_GROUP ? null : groupId }).catch(() => undefined);
  }
}

/** Forget every tab choice this page holds (tests). */
export function resetCurrentGroups(): void {
  memory.clear();
  for (const listener of listeners) listener();
}

export interface CurrentGroup {
  /** The groups this person sees, in menu order. */
  groups: WorkspaceGroup[];
  /** Whether the menu groups by workspace: two groups or more. */
  shown: boolean;
  /** The tab's group; null while the menu does not group. */
  current: WorkspaceGroup | null;
  view: 'one' | 'all';
}

/** The tab's group, kept in step with every other reader of it. */
export function useCurrentGroup(bootstrap: Pick<BootstrapData, 'workspaces' | 'user'>): CurrentGroup {
  const stored = useSyncExternalStore(subscribe, () => read(bootstrap.user.id), () => null);
  const groups = workspaceGroups(bootstrap);
  const shown = groups.length >= 2;
  return {
    groups,
    shown,
    current: shown ? resolveGroup(groups, stored, bootstrap.workspaces?.lastWorkspaceId ?? null) : null,
    view: bootstrap.workspaces?.workspaceView ?? 'all',
  };
}
