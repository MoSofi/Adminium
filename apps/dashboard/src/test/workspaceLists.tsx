// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the Library list tests share for workspaces: a server with two
 * workspaces and one database in none, the tab's choice, and a topbar that
 * draws the chip a list pins by its title.
 *
 * Fernhill Coffee holds `conn_fernhill` and `conn_suppliers`; Kiln Street
 * Pottery holds `conn_kiln` and `conn_suppliers`; `conn_scratch` is in none
 * ("Other databases").
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

import { bootstrapQuery, type BootstrapData } from '../app/bootstrap.js';
import { createQueryClient } from '../app/query.js';
import { PageActionsProvider, PageActionsSlot, PageTitleAdornmentSlot } from '../shell/PageActionsProvider.js';
import { resetCurrentGroups } from '../shell/workspaces/current.js';
import { jsonResponse, makeBootstrap } from './fixtures.js';

export const WS_DB = {
  fernhill: 'conn_fernhill',
  suppliers: 'conn_suppliers',
  kiln: 'conn_kiln',
  scratch: 'conn_scratch',
} as const;

export const COFFEE = { id: 'wsp_coffee', name: 'Fernhill Coffee', initials: 'FC', position: 0, connectionIds: [WS_DB.fernhill, WS_DB.suppliers] };
export const KILN = { id: 'wsp_kiln', name: 'Kiln Street Pottery', initials: 'KS', position: 1, connectionIds: [WS_DB.kiln, WS_DB.suppliers] };

/** A bootstrap whose server shows its workspaces `view`; with no view, a server with none. */
export function workspacesBootstrap(view: 'one' | 'all' | null, overrides: Partial<BootstrapData> = {}): BootstrapData {
  if (view === null) return makeBootstrap(overrides);
  return makeBootstrap({
    workspaces: {
      workspaces: [COFFEE, KILN],
      otherDatabases: [WS_DB.scratch],
      workspaceView: view,
      lastWorkspaceId: null,
      manage: true,
    },
    ...overrides,
  });
}

/** Put this tab in a workspace, as the menu's switcher does. */
export function chooseTabWorkspace(bootstrap: Pick<BootstrapData, 'user'>, workspaceId: string): void {
  window.sessionStorage.setItem(`adminium-workspace:${bootstrap.user.id}`, workspaceId);
}

/** Forget every tab choice: call in `beforeEach`. */
export function resetTabWorkspace(): void {
  window.sessionStorage.clear();
  resetCurrentGroups();
}

/** The half of the topbar a list publishes into: its title adornment and its actions. */
export function ListTopbar({ children }: { children: ReactNode }) {
  return (
    <PageActionsProvider>
      <header data-part="topbar">
        <PageTitleAdornmentSlot />
        <PageActionsSlot />
      </header>
      <main>{children}</main>
    </PageActionsProvider>
  );
}

/** The `workspaceId` a request URL carries, or null. */
export function workspaceIdOf(url: string): string | null {
  const at = url.indexOf('?');
  return at < 0 ? null : new URLSearchParams(url.slice(at + 1)).get('workspaceId');
}

/** A request path (without its query) and what it answers (JSON, status 200). */
export type Answers = readonly (readonly [path: string, body: unknown])[];

/**
 * Mount one list page under a one-route router (for its search params and
 * links) and the topbar half, with the bootstrap already loaded as the shell
 * leaves it. Every request is recorded; the answer for its path replies,
 * anything else is a 404.
 */
export function renderListPage(ui: ReactElement, bootstrap: BootstrapData, answers: Answers): { urls: string[]; queryClient: QueryClient } {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      urls.push(url);
      const path = url.split('?')[0];
      const found = answers.find(([answered]) => answered === path);
      return Promise.resolve(
        found === undefined ? jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }) : jsonResponse(200, found[1]),
      );
    }),
  );
  const queryClient = createQueryClient();
  queryClient.setQueryData(bootstrapQuery().queryKey, bootstrap);
  const root = createRootRoute({ component: () => <ListTopbar>{ui}</ListTopbar> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { urls, queryClient };
}

/** The names on the workspace chips under `root`, in order (each chip's tile is read aloud by nothing). */
export function chipNames(root: ParentNode = document): string[] {
  return [...root.querySelectorAll('[data-part="workspace-chip"]')].map((chip) =>
    [...chip.childNodes]
      .filter((node) => !(node instanceof Element && node.getAttribute('aria-hidden') === 'true'))
      .map((node) => node.textContent ?? '')
      .join(''),
  );
}

/** The names on the chips the topbar shows beside the title. */
export function titleChipNames(): string[] {
  const slot = document.querySelector('[data-part="topbar-title-adornment"]');
  return slot === null ? [] : chipNames(slot);
}

/** Whether anything of workspaces is drawn: a chip, a filter or a column of chips. */
export function anyWorkspaceUi(): boolean {
  return document.querySelector('[data-part="workspace-chip"], [data-part="workspace-filter"], [data-part="workspace-chips"]') !== null;
}
