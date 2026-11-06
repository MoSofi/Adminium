// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Open a workspace from a screen: the tab moves to it, as choosing it in the
 * menu does, and the page becomes its first page.
 *
 * The workspace may be new (a workspace file just made it), so the menu is
 * read again first.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';

import { bootstrapQuery } from '../app/bootstrap.js';
import { chooseGroup } from '../shell/workspaces/current.js';
import { blockContent, workspaceGroups } from '../shell/workspaces/model.js';

export function useOpenWorkspace(): (workspaceId: string) => Promise<void> {
  const queryClient = useQueryClient();
  // Quiet outside a router (a story): there the tab still moves, and no page opens.
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | null | undefined;
  return async (workspaceId) => {
    await queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    const bootstrap = await queryClient.fetchQuery(bootstrapQuery());
    chooseGroup(bootstrap.user.id, workspaceId, { remember: true });
    const group = workspaceGroups(bootstrap).find((one) => one.id === workspaceId);
    const first =
      group === undefined
        ? undefined
        : blockContent(bootstrap.nav, [], group).groups[0]?.items.find((item) => item.offRail !== true && item.link === undefined && item.addOnPage === undefined);
    if (router === null || router === undefined) return;
    if (first !== undefined) await router.navigate({ to: '/p/$slug', params: { slug: first.slug } });
    else await router.navigate({ to: '/' });
  };
}
