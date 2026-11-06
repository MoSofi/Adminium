// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one install of a key a test made: what install-keyed stores (an
 * add-on's settings, its document profiles) are found by. A test with two
 * installs of a key names the one it means instead.
 */
import { manifestsRepo, type MetaDb } from '@adminium/meta';

const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };

export async function onlyInstall(meta: MetaDb, key: string): Promise<{ manifestId: string; addOnKey: string; installId: string }> {
  const all = await manifestsRepo(meta, PLAIN).listByKey(key);
  if (all.length !== 1) throw new Error(`expected one install of "${key}", found ${all.length}`);
  return { manifestId: all[0]!.row.id, addOnKey: key, installId: all[0]!.row.id };
}
