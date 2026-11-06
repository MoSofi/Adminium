// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where "Shown in" reads the workspaces from, and which one this tab is in.
 *
 * The workspaces come from bootstrap (`workspaces`, absent while the server
 * has none). They are read here through a narrow type of their own, so this
 * module does not depend on how the shell types the rest of bootstrap.
 *
 * The tab's current workspace belongs to the menu: the shell knows it (it is
 * kept per tab) and passes it down with {@link ShownInScopeProvider}. With no
 * provider mounted, there is no current workspace and the view is the
 * server's setting: lists are not narrowed until a person picks a workspace
 * in a list's own filter.
 */
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { bootstrapQuery } from '../app/bootstrap.js';

/**
 * The current workspace when the tab is in "Other databases" (the databases
 * in no workspace). Items chosen for workspaces are not listed there; items
 * shown in all workspaces are.
 */
export const OTHER_DATABASES = '~other';

/** A workspace as "Shown in" draws it. */
export interface ShownInWorkspace {
  id: string;
  name: string;
  /** Up to two letters for its tile. */
  initials: string;
  position: number;
}

/** What bootstrap carries, read narrowly (`workspaces` is absent while the server has none). */
interface BootstrapWorkspacesSlice {
  workspaces?: {
    workspaces: { id: string; name: string; initials: string; position: number }[];
    otherDatabases: string[] | null;
    workspaceView: 'one' | 'all';
  };
}

export interface ShownInScope {
  /** The workspaces this person sees, by position. Empty when the server has none (or none for them). */
  workspaces: ShownInWorkspace[];
  /** Whether "Shown in" is drawn at all: only when there is a workspace to choose. */
  active: boolean;
  /** Whether "Other databases" is a group for this person. */
  otherDatabases: boolean;
  /** How the menu shows workspaces: one at a time, or all in one menu. */
  view: 'one' | 'all';
  /** The tab's workspace (an id, or {@link OTHER_DATABASES}); null when the tab is in none. */
  currentWorkspaceId: string | null;
}

export interface ShownInScopeProviderProps {
  /**
   * The workspace this tab is in: a workspace id, {@link OTHER_DATABASES}
   * for the databases in no workspace, or null when the tab is in none (no
   * workspaces, or one visible group).
   */
  currentWorkspaceId: string | null;
  /** How the menu shows workspaces, for everyone on the server. */
  view: 'one' | 'all';
  children?: ReactNode;
}

const Ctx = createContext<Pick<ShownInScopeProviderProps, 'currentWorkspaceId' | 'view'> | null>(null);

/** Mounted once by the shell with the tab's workspace; every "Shown in" list and picker below reads it. */
export function ShownInScopeProvider({ currentWorkspaceId, view, children }: ShownInScopeProviderProps) {
  const value = useMemo(() => ({ currentWorkspaceId, view }), [currentWorkspaceId, view]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShownInScope(): ShownInScope {
  const provided = useContext(Ctx);
  const { data } = useQuery(bootstrapQuery());
  const slice = (data as BootstrapWorkspacesSlice | undefined)?.workspaces;
  return useMemo(() => {
    const workspaces = [...(slice?.workspaces ?? [])]
      .sort((a, b) => a.position - b.position)
      .map(({ id, name, initials, position }) => ({ id, name, initials, position }));
    const current = provided?.currentWorkspaceId ?? null;
    return {
      workspaces,
      active: workspaces.length > 0,
      otherDatabases: (slice?.otherDatabases ?? null) !== null,
      view: provided?.view ?? slice?.workspaceView ?? 'all',
      // A workspace this person no longer sees is no current workspace.
      currentWorkspaceId: current === OTHER_DATABASES || workspaces.some((one) => one.id === current) ? current : null,
    };
  }, [slice, provided]);
}
