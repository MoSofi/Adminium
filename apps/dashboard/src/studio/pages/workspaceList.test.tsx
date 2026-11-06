// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Pages under workspaces. The "All pages" list follows the
 * workspace; the sidebar organizer keeps every page, because it saves the
 * whole rail's order at once.
 *  - a server with none asks and draws exactly what it always did;
 *  - One at a time: the list is the tab's workspace's, named by the title;
 *  - All in one menu: each page's workspaces beside its database, and a
 *    filter that narrows the request.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import {
  KILN,
  WS_DB,
  anyWorkspaceUi,
  chipNames,
  chooseTabWorkspace,
  renderListPage,
  resetTabWorkspace,
  titleChipNames,
  workspaceIdOf,
  workspacesBootstrap,
} from '../../test/workspaceLists.js';
import type { PageSummaryDto } from './pagesApi.js';
import { StudioPagesPage } from './StudioPagesPage.js';

function page(id: string, slug: string, connectionId: string | null): PageSummaryDto {
  return {
    id,
    connectionId,
    connectionName: connectionId,
    connectionPaused: false,
    slug,
    type: 'page-crud',
    title: slug,
    icon: 'table',
    navGroup: 'library',
    navOrder: 0,
    origin: 'generated',
    manifestId: null,
    isEnabled: true,
    revision: 1,
    updatedAt: 1,
  };
}

const PAGES = [page('page_orders', 'orders', WS_DB.suppliers), page('page_notes', 'notes', null)];
const answers = [['/api/v1/pages', { data: PAGES }]] as const;
const listUrls = (urls: string[]) => urls.filter((url) => url.split('?')[0] === '/api/v1/pages');
const rowOf = (slug: string) => screen.getByText(`/p/${slug}`).closest('li')!;

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
beforeEach(() => {
  resetTabWorkspace();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Studio → Pages', () => {
  it('on a server with no workspace, asks once for every page and draws nothing of workspaces', async () => {
    const { urls } = renderListPage(<StudioPagesPage />, workspacesBootstrap(null), answers);
    await screen.findByText('/p/orders');
    expect(listUrls(urls)).toEqual(['/api/v1/pages']);
    expect(anyWorkspaceUi()).toBe(false);
  });

  it('One at a time: the list asks for the tab\'s workspace, the organizer for every page', async () => {
    const bootstrap = workspacesBootstrap('one');
    chooseTabWorkspace(bootstrap, KILN.id);
    const { urls } = renderListPage(<StudioPagesPage />, bootstrap, answers);
    await screen.findByText('/p/orders');
    expect(listUrls(urls).map(workspaceIdOf).sort()).toEqual([KILN.id, null].sort());
    expect(titleChipNames()).toEqual(['Kiln Street Pottery']);
    expect(document.querySelector('[data-part="workspace-filter"]')).toBeNull();
    expect(document.querySelector('[data-part="workspace-chips"]')).toBeNull();
  });

  it('All in one menu: each page\'s workspaces beside its database, and the filter narrows the request', async () => {
    const user = userEvent.setup();
    const { urls } = renderListPage(<StudioPagesPage />, workspacesBootstrap('all'), answers);
    await screen.findByText('/p/orders');
    expect(listUrls(urls).map(workspaceIdOf)).toEqual([null]);
    expect(titleChipNames()).toEqual([]);
    const orders = rowOf('orders');
    expect(chipNames(orders)).toEqual(['Fernhill Coffee', 'Kiln Street Pottery']);
    // Right after the database chip.
    expect(within(orders).getByTestId('studio-pages-connection').nextElementSibling?.getAttribute('data-part')).toBe('workspace-chips');
    // A page of no database has no workspace to name.
    expect(chipNames(rowOf('notes'))).toEqual([]);

    await user.selectOptions(screen.getByLabelText('Workspace'), KILN.id);
    await waitFor(() => expect(listUrls(urls).map(workspaceIdOf)).toEqual([null, KILN.id]));
  });
});
