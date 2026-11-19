// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT IS INSTALLED, ASKED ON EVERY WRITE: `recent()` reads the store's stamp
 * at most once a second, on each meta engine.
 *
 *  - fifty writes in one second read the stamp once (the found-people guard
 *    asks on every create and update, each line of an import included);
 *  - an install in this process (`changed()`) is seen at the very next ask;
 *  - an install by another process is seen once the second has passed;
 *  - `fresh()` still reads the stamp every time.
 */
import { manifestsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addOnInstallsStamp } from '../src/apps/add-on-tables.js';
import { keepAddOnInstalls, RECENT_INSTALLS_MS } from '../src/apps/table-ref.js';
import { leadFinder } from '../../../packages/manifest/test/lead-finder-fixture.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

describe.each(META_ENGINES)('what is installed, asked on every write — $name', (engine) => {
  let handle: MetaHandle;
  let clock = 0;
  let reads = 0;
  const keeper = (meta: MetaDb) =>
    keepAddOnInstalls(meta, async () => null, {
      now: () => clock,
      stamp: async (store) => {
        reads += 1;
        return addOnInstallsStamp(store);
      },
    });
  const installAnother = (meta: MetaDb, key: string) =>
    manifestsRepo(meta, { encrypt: (value) => value, decrypt: (value) => value }).install({ manifestKey: key, version: '1.0.0', kind: 'add-on', source: 'file', document: { ...leadFinder(), key } });

  beforeEach(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    clock = 1_000_000;
    reads = 0;
  });
  afterEach(async () => {
    if (engine.available) await handle.destroy();
  });

  it.skipIf(!engine.available)('reads the stamp once for fifty writes in a second', async () => {
    const installs = keeper(handle.meta);
    for (let n = 0; n < 50; n += 1) {
      await installs.recent();
      clock += 10;
    }
    expect(reads).toBe(1);
    // A second on: asked again.
    clock += RECENT_INSTALLS_MS;
    await installs.recent();
    expect(reads).toBe(2);
    // `fresh()` is never held.
    await installs.fresh();
    await installs.fresh();
    expect(reads).toBe(4);
  });

  it.skipIf(!engine.available)('sees an install made in this process at once, and one made by another process within the second', async () => {
    const installs = keeper(handle.meta);
    const before = await installs.recent();
    expect(reads).toBe(1);

    // Another process installs: this one answers what it read until the second has passed.
    await installAnother(handle.meta, 'company-finder');
    clock += 100;
    const held = await installs.recent();
    expect(reads).toBe(1);
    expect(held).toBe(before);
    clock += RECENT_INSTALLS_MS;
    const seen = await installs.recent();
    expect(reads).toBe(2);
    expect(seen).not.toBe(held);

    // This process installs: the next ask reads the stamp, whatever the clock says.
    await installAnother(handle.meta, 'company-finder-two');
    installs.changed();
    const after = await installs.recent();
    expect(reads).toBe(3);
    expect(after).not.toBe(seen);
    // And is held again after that.
    await installs.recent();
    expect(reads).toBe(3);
  });
});
