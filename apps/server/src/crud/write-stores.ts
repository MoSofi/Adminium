// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the write service reads from the meta store, for a service built over
 * one: the counters a running number claims from, the connection's time zone
 * a rule reads its clock in, the settings a rule reads — the connection's
 * currency and an add-on's settings — and the roles of whoever writes, for a
 * move only some roles may make.
 */
import type { Manifest } from '@adminium/manifest';
import { addOnSettingsRepo, apiKeysRepo, connectionTenantConfig, documentSequencesRepo, readJson, rolesRepo, type MetaDb } from '@adminium/meta';

import { SUPER_ADMIN_SLUG } from '../rbac/resolver.js';
import type { WriteServiceOptions } from './write-service.js';

/**
 * One of an add-on's settings: the value the install saved, else the default
 * the add-on declares — a fresh install already has its prefixes, its ladder
 * and its default terms before anyone opens the settings page. A secret is
 * never read by a rule.
 */
export async function addOnSetting(meta: MetaDb, addOnKey: string, setting: string): Promise<unknown> {
  const saved = (await addOnSettingsRepo(meta).valuesFor(addOnKey))[setting];
  if (saved !== undefined && saved !== null) return saved;
  const row = await meta.db
    .selectFrom('adminium_manifests')
    .select('manifest')
    .where('manifestKey', '=', addOnKey)
    .where('kind', '=', 'add-on')
    .where('status', '=', 'installed')
    .executeTakeFirst();
  const declared = (readJson<Manifest | null>(row?.manifest ?? null)?.settings ?? []).find((candidate) => candidate.key === setting);
  if (declared === undefined || declared.secret === true) return undefined;
  return 'default' in declared ? declared.default : undefined;
}

export function writeStores(meta: MetaDb): Pick<WriteServiceOptions, 'sequences' | 'timezoneOf' | 'settings' | 'rolesOf'> {
  return {
    sequences: documentSequencesRepo(meta),
    timezoneOf: async (connectionId) => (await connectionTenantConfig(meta, connectionId))?.timezone ?? null,
    settings: {
      currency: async (connectionId) => (await connectionTenantConfig(meta, connectionId))?.currency ?? null,
      addOnSetting: (addOnKey, setting) => addOnSetting(meta, addOnKey, setting),
    },
    rolesOf: async (actor) => {
      const roles = rolesRepo(meta);
      let held: { slug: string }[] = [];
      if (actor?.kind === 'user' && actor.id !== null) held = await roles.rolesForUser(actor.id);
      if (actor?.kind === 'api-key' && actor.id !== null) {
        const key = await apiKeysRepo(meta).findById(actor.id);
        const role = key === null ? null : await roles.findById(key.roleId);
        held = role === null ? [] : [role];
      }
      return held.some((role) => role.slug === SUPER_ADMIN_SLUG) ? 'any' : new Set(held.map((role) => role.slug));
    },
  };
}
