/**
 * Onboarding-state routes (M5-T06, 09-generated-app.md):
 *
 *   GET  /api/v1/onboarding          → { data: { checklist, dismissed } }
 *   POST /api/v1/onboarding/dismiss  → persist the per-user dismissal, then
 *                                       return the fresh state.
 *
 * The checklist is derived from live workspace state on every request
 * (see ./derive.ts) — never from click-time booleans. Guarded by
 * `system:connections:manage` (the admin built-in role has it; viewers/editors
 * do not), so the surface is admin-only. Dismissal is a per-user UI preference
 * stored in `adminium_user_prefs.uiState` — the same per-user pref store the
 * theme axes use (07-meta-store.md §3.4) — so it is not audit-logged, matching
 * the sibling `me/prefs` writes.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import {
  readJsonOrNull,
  settingsRepo,
  userPrefsRepo,
  usersRepo,
  type MetaDb,
  type SettingKey,
} from '@adminium/meta';

import { PERMISSIONS } from '../../rbac/permissions.js';
import { deriveChecklist, type OnboardingChecklist, type OnboardingFacts } from './derive.js';
import { onboardingDismissBody, onboardingReply, type OnboardingReply } from './schema.js';

/** Admin built-in role grant (super-admin has every system action). */
export const ONBOARDING_VIEW = 'system:connections:manage';

/** uiState key holding the per-user dismissal flag. */
export const ONBOARDING_DISMISSED_KEY = 'onboardingDismissed';

/** Workspace-default axes an admin explicitly saved (07-meta-store.md §7.1). */
const WORKSPACE_DEFAULT_KEYS: readonly SettingKey[] = [
  'appearance.theme',
  'appearance.accent',
  'appearance.density',
  'locale.default',
];

export interface OnboardingRoutesDeps {
  meta: MetaDb;
}

function currentUserId(request: FastifyRequest): string | null {
  if (request.apiKeyPrincipal !== null) return null;
  return (request as unknown as { user?: { id?: string } }).user?.id ?? null;
}

export function onboardingRoutes(deps: OnboardingRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const users = usersRepo(meta);
  const settings = settingsRepo(meta);
  const prefs = userPrefsRepo(meta);

  async function gatherFacts(canManageWorkspaceDefaults: boolean): Promise<OnboardingFacts> {
    const [connectionRows, userCount, overrides] = await Promise.all([
      // Only id + settings — no DSN material, so no crypto/adapter dependency.
      meta.db.selectFrom('adminium_connections').select(['id', 'settings']).execute(),
      users.count(),
      settings.overrides(),
    ]);
    const hasIncludedTables = connectionRows.some((row) => {
      const parsed = readJsonOrNull<{ includedTables?: string[] }>(row.settings);
      return (parsed?.includedTables?.length ?? 0) > 0;
    });
    const hasWorkspaceDefaults = WORKSPACE_DEFAULT_KEYS.some((key) => overrides[key] !== undefined);
    return {
      connectionCount: connectionRows.length,
      hasIncludedTables,
      userCount,
      hasWorkspaceDefaults,
      canManageWorkspaceDefaults,
    };
  }

  async function readDismissed(userId: string | null): Promise<boolean> {
    if (userId === null) return false;
    const row = await prefs.get(userId);
    return row?.uiState?.[ONBOARDING_DISMISSED_KEY] === true;
  }

  async function buildReply(request: FastifyRequest): Promise<OnboardingReply> {
    const [canManageWorkspaceDefaults, dismissed] = await Promise.all([
      request.can(PERMISSIONS.settingsManage),
      readDismissed(currentUserId(request)),
    ]);
    const facts = await gatherFacts(canManageWorkspaceDefaults);
    const checklist: OnboardingChecklist = deriveChecklist(facts);
    return { data: { checklist, dismissed } };
  }

  return async (app) => {
    app.get(
      '/onboarding',
      {
        preHandler: app.rbac.require(ONBOARDING_VIEW),
        schema: { response: { 200: onboardingReply } },
      },
      async (request) => buildReply(request),
    );

    app.post(
      '/onboarding/dismiss',
      {
        preHandler: app.rbac.require(ONBOARDING_VIEW),
        schema: { body: onboardingDismissBody, response: { 200: onboardingReply } },
      },
      async (request) => {
        const userId = currentUserId(request);
        if (userId !== null) {
          const existing = await prefs.get(userId);
          const uiState = { ...(existing?.uiState ?? {}), [ONBOARDING_DISMISSED_KEY]: request.body.dismissed };
          await prefs.set(userId, { uiState });
        }
        return buildReply(request);
      },
    );
  };
}
