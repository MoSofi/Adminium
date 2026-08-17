// SPDX-License-Identifier: AGPL-3.0-only
/**
 * §6 step 1's three bridge calls, in one place.
 *
 * `lib/desktop-runtime.ts`'s rule applies and is worth restating at this call
 * site: the bridge is for NATIVE AFFORDANCES only, and a data directory is as
 * native as it gets — a path on this machine, in a file the main process owns
 * (§2.3), that decides how the server is launched. The server cannot answer a
 * question about it; `GET /system/info` does not have a `dataDir` field and must
 * not grow one.
 *
 * Every function here returns `null` when there is no bridge rather than
 * throwing. The wizard renders on desktop only, so `null` is unreachable in
 * production — but it is reachable in a jsdom test and in a browser tab someone
 * pointed at `/desktop/setup`, and a `TypeError` is a worse answer than "this
 * affordance does not exist here".
 */

import type { SetDataDirResult } from '@adminium/desktop/api';

import { getDesktopApi } from '../../lib/desktop-runtime.js';
import { t } from '../../i18n/t.js';

/** The directory the app booted against (§2.2 step 5), or `null` off-desktop. */
export async function readDataDir(): Promise<string | null> {
  const api = getDesktopApi();
  if (api === null) return null;
  return (await api.getRuntimeInfo()).dataDir;
}

/**
 * §6 step 1's "Change…" — the native directory picker. `null` on cancel, and
 * also `null` with no bridge; the caller treats both the same way (nothing was
 * chosen), which is why they are not distinguished.
 */
export async function chooseDataDir(defaultPath: string | null): Promise<string | null> {
  const api = getDesktopApi();
  if (api === null) return null;
  return api.chooseDirectory({
    title: t('desktop.setup.dataDir.dialogTitle', 'Choose where Adminium keeps your data'),
    ...(defaultPath === null ? {} : { defaultPath }),
  });
}

/**
 * Commit a data directory. Resolving with `applied` means the app is ALREADY
 * relaunching (see `api.d.ts`'s `SetDataDirResult`) — unless the directory was
 * unchanged, in which case nothing happened and nothing needed to.
 */
export async function commitDataDir(
  dir: string,
  acknowledgeCloudSync: boolean,
): Promise<SetDataDirResult | null> {
  const api = getDesktopApi();
  if (api === null) return null;
  return api.setDataDir({ dir, acknowledgeCloudSync });
}
