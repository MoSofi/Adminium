// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Return the built-in roles to ZERO data access in a test harness.
 *
 * `firstRun` seeds Admin, Editor and Viewer with wildcard page and table
 * grants, which is what a real install needs. Most route suites, though, were
 * written when those roles started empty, and use Editor and Viewer as the
 * principals a denial path is proven against: grant one table, then assert the
 * next one is refused. With the wildcards in place every such refusal would
 * silently turn into a success and the test would stop testing anything.
 *
 * So a harness that grants per table calls this right after `firstRun`, and
 * the seeded defaults themselves are covered where they belong — meta's
 * bootstrap test and the bootstrap route test.
 */
import { ALL_PAGES_REF, ALL_TABLES_REF, permissionsRepo, rolesRepo, type MetaDb } from '@adminium/meta';

export async function withoutDefaultDataGrants(meta: MetaDb): Promise<void> {
  const roles = rolesRepo(meta);
  const permissions = permissionsRepo(meta);
  for (const slug of ['admin', 'editor', 'viewer']) {
    const role = await roles.findBySlug(slug);
    if (role === null) continue;
    await permissions.revoke(role.id, 'page', ALL_PAGES_REF);
    await permissions.revoke(role.id, 'table', ALL_TABLES_REF);
  }
}
