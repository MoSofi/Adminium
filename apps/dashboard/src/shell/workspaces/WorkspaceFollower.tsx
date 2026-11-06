// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The link rule: a page opened by its address (a link, a bookmark, the
 * palette, the back button) keeps the tab's workspace when that workspace
 * holds the page's database; otherwise the tab moves to the first workspace
 * by position that does, or to "Other databases". In One at a time the move
 * is said: "Switched to {name}". A page of no database (Library, People, a
 * shared page) never moves anything.
 *
 * It reads the pages, and the screens of an app or add-on installed on a
 * database. A detail screen of another connection-bound item can follow the
 * same rule with {@link useFollowDatabase}.
 */
import { useEffect, useRef } from 'react';
import { useRouterState } from '@tanstack/react-router';

import { appSectionsOf, findPageBySlug, type BootstrapData } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { chooseGroup, useCurrentGroup } from './current.js';
import { groupForDatabase } from './model.js';
import { groupName } from './WorkspaceTile.js';

/** The database a dashboard address is a screen of, or null for a screen of none. */
export function databaseOfPath(bootstrap: BootstrapData, pathname: string): string | null {
  const page = /^\/p\/([^/]+)/.exec(pathname);
  if (page !== null) return findPageBySlug(bootstrap, decodeURIComponent(page[1] ?? ''))?.connectionId ?? null;
  // An app's hosted screens (`/a/<key>[~<slug>]/…`) and an add-on's pages (`/add-ons/<key>/…`): their install's database.
  const install = /^\/(?:a|add-ons)\/([^/]+)/.exec(pathname);
  if (install !== null) {
    const key = decodeURIComponent(install[1] ?? '');
    const section = appSectionsOf(bootstrap).find((entry) => entry.appKey === key);
    return typeof section?.connectionId === 'string' ? section.connectionId : null;
  }
  return null;
}

/**
 * Move the tab to a workspace holding `connectionId` when its own does not:
 * for a screen of a connection-bound item that is not a page (an automation
 * on kiln). Says so in One at a time.
 */
export function useFollowDatabase(bootstrap: BootstrapData, connectionId: string | null | undefined): void {
  const { groups, current, shown, view } = useCurrentGroup(bootstrap);
  const toasts = useAppToasts();
  const said = useRef<string | null>(null);
  const target = shown ? groupForDatabase(groups, current, connectionId) : null;
  useEffect(() => {
    if (target === null) return;
    chooseGroup(bootstrap.user.id, target.id);
    if (view === 'one' && said.current !== `${String(connectionId)}:${target.id}`) {
      said.current = `${String(connectionId)}:${target.id}`;
      toasts.push({ variant: 'info', title: t('workspaces.switched', 'Switched to {name}', { name: groupName(target) }) });
    }
  }, [target, bootstrap.user.id, connectionId, view, toasts]);
}

/** Rendered once by the shell: follows the address. */
export function WorkspaceFollower({ bootstrap }: { bootstrap: BootstrapData }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useFollowDatabase(bootstrap, databaseOfPath(bootstrap, pathname));
  return null;
}
