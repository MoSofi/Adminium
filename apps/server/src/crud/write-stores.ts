// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the write service reads from the meta store, for a service built over
 * one: the counters a running number claims from, and the connection's time
 * zone a rule reads its clock in.
 */
import { connectionTenantConfig, documentSequencesRepo, type MetaDb } from '@adminium/meta';

import type { WriteServiceOptions } from './write-service.js';

export function writeStores(meta: MetaDb): Pick<WriteServiceOptions, 'sequences' | 'timezoneOf'> {
  return {
    sequences: documentSequencesRepo(meta),
    timezoneOf: async (connectionId) => (await connectionTenantConfig(meta, connectionId))?.timezone ?? null,
  };
}
