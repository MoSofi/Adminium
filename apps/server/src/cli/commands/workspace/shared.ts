// SPDX-License-Identifier: AGPL-3.0-only
/** What the workspace commands share: the meta store flags and how they open it. */
import type { MetaDb } from '@adminium/meta';

import { stringFlag, type FlagSpecs } from '../../args.js';
import type { Command } from '../../command.js';
import { loadCliEnv } from '../../runtime.js';

export const storeFlags: FlagSpecs = {
  'data-dir': { type: 'string', placeholder: '<path>', describe: 'Data directory', defaultDescription: 'ADMINIUM_DATA_DIR, else ./data or ~/.adminium' },
  'meta-url': { type: 'string', placeholder: '<dsn>', describe: 'Meta store DSN' },
};

export function envOf(deps: Parameters<Command['run']>[0]['deps'], values: Record<string, unknown>) {
  const dataDir = stringFlag(values['data-dir'] as string | undefined);
  const metaUrl = stringFlag(values['meta-url'] as string | undefined);
  return loadCliEnv(deps.env, { ...(dataDir === undefined ? {} : { dataDir }), ...(metaUrl === undefined ? {} : { metaUrl }) });
}

export async function connectionNames(meta: MetaDb): Promise<Map<string, string>> {
  return new Map((await meta.db.selectFrom('adminium_connections').select(['id', 'name']).execute()).map((row) => [row.id, row.name]));
}

