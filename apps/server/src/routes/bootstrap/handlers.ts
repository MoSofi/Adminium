/**
 * `GET /api/v1/bootstrap` handler (09-generated-app.md §2.1) — deliberately
 * thin: one query per concern, no fan-out beyond what the shell needs on a
 * cold load.
 *
 * - session user + role slugs via the existing auth plumbing;
 * - preference axes resolved server-side (`userPrefsRepo.resolve`, §7.2);
 * - nav tree from enabled `adminium_pages` rows bucketed into the five fixed
 *   groups (rows land in M4 Wave B generation — an empty tree is valid);
 * - `version` (server build) + `configVersion` (max page `updatedAt`) so the
 *   client can drop stale caches on WS `config-changed`.
 *
 * TODO(Wave B, 09-T02): filter nav rows by the caller's page `access` grants
 * once page-level permissions land with the pages routes.
 */
import type { FastifyRequest } from 'fastify';
import { readBool, rolesRepo, userPrefsRepo, type User } from '@adminium/meta';

import { UnauthorizedError } from '../../errors.js';
import type { AuthContext } from '../../plugins/auth.js';
import { toUserView } from '../auth/handlers.js';
import { APP_VERSION } from '../../version.js';
import {
  NAV_GROUP_KEYS,
  type BootstrapNavItem,
  type BootstrapNavTree,
  type BootstrapReply,
  type NavGroupKey,
} from './schema.js';

function principal(request: FastifyRequest): User {
  if (request.user === null) throw new UnauthorizedError('UNAUTHENTICATED');
  return request.user;
}

interface NavSourceRow {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  navGroup: string | null;
  navOrder: number;
  isEnabled: boolean | 0 | 1;
  updatedAt: number;
}

/** Buckets page rows into the five fixed groups; empty groups are omitted. */
export function buildNavTree(rows: readonly NavSourceRow[]): {
  nav: BootstrapNavTree;
  configVersion: number;
} {
  let configVersion = 0;
  const buckets = new Map<NavGroupKey, BootstrapNavItem[]>();

  for (const row of rows) {
    // Every page row advances the config stamp, nav-visible or not.
    if (row.updatedAt > configVersion) configVersion = row.updatedAt;
    if (!readBool(row.isEnabled)) continue;
    const group = (NAV_GROUP_KEYS as readonly string[]).includes(row.navGroup ?? '')
      ? (row.navGroup as NavGroupKey)
      : null;
    if (group === null) continue;
    const items = buckets.get(group) ?? [];
    items.push({
      pageId: row.id,
      slug: row.slug,
      labelKey: `nav.${row.slug}`,
      fallback: row.title,
      icon: row.icon ?? 'file',
      order: row.navOrder,
    });
    buckets.set(group, items);
  }

  const groups = NAV_GROUP_KEYS.flatMap((key) => {
    const items = buckets.get(key);
    if (items === undefined || items.length === 0) return [];
    items.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
    return [{ key, items }];
  });

  return { nav: { groups }, configVersion };
}

export async function bootstrapHandler(
  ctx: AuthContext,
  request: FastifyRequest,
): Promise<BootstrapReply> {
  const user = principal(request);

  const [roles, prefs, pageRows] = await Promise.all([
    rolesRepo(ctx.meta).rolesForUser(user.id),
    userPrefsRepo(ctx.meta).resolve(user.id),
    ctx.meta.db
      .selectFrom('adminium_pages')
      .select(['id', 'slug', 'title', 'icon', 'navGroup', 'navOrder', 'isEnabled', 'updatedAt'])
      .execute(),
  ]);

  const { nav, configVersion } = buildNavTree(pageRows);

  return {
    data: {
      user: toUserView(user),
      roles: roles.map((role) => role.slug),
      prefs,
      nav,
      version: APP_VERSION,
      configVersion,
      // LLM assist config lands in M6 (06-llm-assist.md) — hard-off until then.
      llm: { enabled: false },
    },
  };
}
