/**
 * Global-defaults settings routes (10-i18n-theming.md §7.2/§7.3, M8-T04):
 *
 *   GET /api/v1/settings/defaults — the four workspace default axes plus
 *     per-axis adoption counts (`following` = users with a NULL override,
 *     i.e. users who will see a change to that default immediately).
 *   PUT /api/v1/settings/defaults — full-object write. Audit-logged
 *     (category `settings`) and broadcast as `settings.defaults.updated` on
 *     the `config-changed` realtime channel so signed-in users following
 *     defaults re-resolve live without a reload.
 *
 * Both guarded by `system:settings:manage` (Super Admin built-in role).
 * Factory plugin registered by composition, like the sibling resources —
 * see apps/server/scripts/demo-v01.mjs.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { settingsRepo, type MetaDb } from '@adminium/meta';

import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  settingsBrandingPutBody,
  settingsDefaultsPutBody,
  settingsDefaultsReply,
  settingsWorkspaceReply,
  type SettingsDefaultsReply,
  type SettingsWorkspaceReply,
} from './schema.js';

/** Realtime event type carried on the `config-changed` channel (§7.2). */
export const SETTINGS_DEFAULTS_UPDATED = 'settings.defaults.updated';

export interface SettingsRoutesDeps {
  meta: MetaDb;
}

const AXES = ['theme', 'accent', 'density', 'locale'] as const;
type Axis = (typeof AXES)[number];

/** Settings-registry key per preference axis (07-meta-store.md §7.1). */
const SETTING_KEY: Record<Axis, 'appearance.theme' | 'appearance.accent' | 'appearance.density' | 'locale.default'> = {
  theme: 'appearance.theme',
  accent: 'appearance.accent',
  density: 'appearance.density',
  locale: 'locale.default',
};

export function settingsRoutes(deps: SettingsRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const settings = settingsRepo(meta);

  async function readDefaults(): Promise<{
    theme: SettingsDefaultsReply['data']['theme'];
    accent: SettingsDefaultsReply['data']['accent'];
    density: SettingsDefaultsReply['data']['density'];
    locale: SettingsDefaultsReply['data']['locale'];
  }> {
    const [theme, accent, density, locale] = await Promise.all([
      settings.get('appearance.theme'),
      settings.get('appearance.accent'),
      settings.get('appearance.density'),
      settings.get('locale.default'),
    ]);
    return { theme, accent, density, locale };
  }

  /** `following` = totalUsers − users holding a non-NULL override for the axis. */
  async function readAdoption(): Promise<SettingsDefaultsReply['data']['adoption']> {
    const totalRow = await meta.db
      .selectFrom('adminium_users')
      .select((eb) => eb.fn.countAll().as('total'))
      .executeTakeFirst();
    const totalUsers = Number(totalRow?.total ?? 0);

    const prefRows = await meta.db
      .selectFrom('adminium_user_prefs')
      .select(['theme', 'accent', 'density', 'locale'])
      .execute();

    const following = { theme: totalUsers, accent: totalUsers, density: totalUsers, locale: totalUsers };
    for (const row of prefRows) {
      for (const axis of AXES) {
        if (row[axis] !== null) following[axis] -= 1;
      }
    }
    return { totalUsers, following };
  }

  async function reply(): Promise<SettingsDefaultsReply> {
    const [defaults, adoption] = await Promise.all([readDefaults(), readAdoption()]);
    return { data: { ...defaults, adoption } };
  }

  /** Registry-backed workspace identity view (M5-T05). */
  async function workspaceReply(): Promise<SettingsWorkspaceReply> {
    const appName = await settings.get('branding.appName');
    return { data: { branding: { appName } } };
  }

  return async (app) => {
    app.get(
      '/settings/defaults',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { response: { 200: settingsDefaultsReply } },
      },
      async () => reply(),
    );

    app.put(
      '/settings/defaults',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { body: settingsDefaultsPutBody, response: { 200: settingsDefaultsReply } },
      },
      async (request) => {
        const before = await readDefaults();
        const next = request.body;
        const at = app.rbac.now();
        const actingUserId =
          request.apiKeyPrincipal === null
            ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
            : null;

        for (const axis of AXES) {
          if (before[axis] === next[axis]) continue;
          await settings.set(SETTING_KEY[axis], next[axis], { updatedBy: actingUserId, at });
        }

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'settings.defaults.update',
          changes: { before: { ...before }, after: { ...next } },
        });

        // Live propagation (§7.2/§7.3): every signed-in session follows
        // `config-changed`; clients following a default re-resolve via
        // bootstrap invalidation on this event type.
        if (app.hasDecorator('realtime')) {
          app.realtime.publish('config-changed', SETTINGS_DEFAULTS_UPDATED, { ...next }, at);
        }

        return reply();
      },
    );

    // --- workspace identity (M5-T05, sectioned puts per 08 §2.16) -------------
    // Same conventions as /settings/defaults: Zod body, super-admin guard,
    // audit with before/after images. No realtime broadcast — nothing in the
    // bootstrap payload derives from this key yet. The `auth.*` security
    // controls are deliberately not exposed until an auth flow enforces them
    // (see schema.ts) — persisting inert security toggles is worse than absent.

    app.get(
      '/settings/workspace',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { response: { 200: settingsWorkspaceReply } },
      },
      async () => workspaceReply(),
    );

    app.put(
      '/settings/branding',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { body: settingsBrandingPutBody, response: { 200: settingsWorkspaceReply } },
      },
      async (request) => {
        const before = (await workspaceReply()).data.branding;
        const at = app.rbac.now();
        const actingUserId =
          request.apiKeyPrincipal === null
            ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
            : null;
        if (before.appName !== request.body.appName) {
          await settings.set('branding.appName', request.body.appName, {
            updatedBy: actingUserId,
            at,
          });
        }
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'settings.branding.update',
          changes: { before: { ...before }, after: { ...request.body } },
        });
        return workspaceReply();
      },
    );
  };
}
