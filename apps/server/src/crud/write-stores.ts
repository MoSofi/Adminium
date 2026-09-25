// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the write service reads from the meta store, for a service built over
 * one: the counters a running number claims from, the connection's time zone
 * a rule reads its clock in, and the settings a rule reads — the connection's
 * currency and an add-on's settings.
 */
import { addOnSettingsRepo, connectionTenantConfig, documentSequencesRepo, type MetaDb } from '@adminium/meta';

import type { WriteServiceOptions } from './write-service.js';

export function writeStores(meta: MetaDb): Pick<WriteServiceOptions, 'sequences' | 'timezoneOf' | 'settings'> {
  const addOnSettings = addOnSettingsRepo(meta);
  return {
    sequences: documentSequencesRepo(meta),
    timezoneOf: async (connectionId) => (await connectionTenantConfig(meta, connectionId))?.timezone ?? null,
    settings: {
      currency: async (connectionId) => (await connectionTenantConfig(meta, connectionId))?.currency ?? null,
      addOnSetting: async (addOnKey, setting) => (await addOnSettings.valuesFor(addOnKey))[setting],
    },
  };
}
