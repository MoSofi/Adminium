// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Give a new page the access list its siblings already have.
 *
 * Shared by the page-create route and the app installer: an
 * app's pages used to be written with no `page:` grant at all, so on an install
 * where an admin had built a page matrix by hand they vanished from every
 * non-super-admin's sidebar.
 *
 * Nothing in this product wrote a `page:` grant for a long time — not the
 * generator, not the LLM apply path — so on most installs there are no sibling
 * grants and this is a no-op, exactly matching how a *generated* page behaves.
 * Where an admin HAS hand-built a matrix via `PUT /roles/:id/permissions`, a
 * page created next to those pages inherits their audience.
 *
 * Union rather than intersection, and view-only: a role that can see any page
 * in this connection can see the new one; edit rights on the stored document
 * stay something an admin grants deliberately.
 */
import { pagesRepo, permissionsRepo, type MetaDb } from '@adminium/meta';

export async function seedPageGrants(
  meta: MetaDb,
  page: { id: string; connectionId: string | null },
): Promise<void> {
  const permissions = permissionsRepo(meta);
  const siblings = (await pagesRepo(meta).listAll()).filter(
    (row) => row.id !== page.id && row.connectionId === page.connectionId,
  );
  if (siblings.length === 0) return;
  const roleIds = new Set<string>();
  for (const sibling of siblings) {
    for (const grant of await permissions.listForResource('page', sibling.id)) {
      if ((grant.actions as { view?: boolean }).view === true) roleIds.add(grant.roleId);
    }
  }
  for (const roleId of roleIds) {
    await permissions.grant(roleId, 'page', page.id, { view: true, edit: false });
  }
}
