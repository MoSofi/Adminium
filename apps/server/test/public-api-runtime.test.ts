// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public surface's shared runtime (`public-api/runtime.ts`).
 *
 * Two things a request pays for before it reads a row: the schema view it
 * compiles against, and the `touch` writes it leaves behind. The view is
 * rebuilt only when the snapshot moves, and a key or session is written at
 * most once a minute.
 */

import { snapshotsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPublicViews,
  createRevisionWatch,
  createTouchThrottle,
  PUBLIC_TOUCH_INTERVAL_MS,
} from '../src/public-api/runtime.js';
import { makeInstall, type Install } from './project-fixtures.js';

let install: Install | null = null;
afterEach(async () => {
  await install?.close();
  install = null;
});

describe('createTouchThrottle', () => {
  it('lets one write per id through per interval', () => {
    let clock = 0;
    const throttle = createTouchThrottle(PUBLIC_TOUCH_INTERVAL_MS, () => clock);
    expect(throttle.due('pbk_1')).toBe(true);
    expect(throttle.due('pbk_1')).toBe(false);
    // Another key is not held back by the first one's write.
    expect(throttle.due('pbk_2')).toBe(true);
    clock += PUBLIC_TOUCH_INTERVAL_MS - 1;
    expect(throttle.due('pbk_1')).toBe(false);
    clock += 1;
    expect(throttle.due('pbk_1')).toBe(true);
  });
});

describe('createPublicViews', () => {
  it('reuses the view until the snapshot moves', async () => {
    install = await makeInstall();
    const views = createPublicViews(install.meta);
    const first = await views.viewFor(install.mainId);
    expect(first).not.toBeNull();
    expect(await views.viewFor(install.mainId)).toBe(first);

    const snapshots = snapshotsRepo(install.meta);
    const current = await snapshots.latest(install.mainId);
    await snapshots.create({
      connectionId: install.mainId,
      source: 'introspection',
      schema: current!.schema,
      checksum: `${current!.checksum}-next`,
    });
    const next = await views.viewFor(install.mainId);
    expect(next).not.toBeNull();
    expect(next).not.toBe(first);
  });

  it('answers null for a connection with no snapshot', async () => {
    install = await makeInstall();
    expect(await createPublicViews(install.meta).viewFor('con_missing')).toBeNull();
  });
});

describe('createRevisionWatch', () => {
  it('fires when the revision moves, not on the first read, and not on a failed one', async () => {
    let revision = 3;
    let fail = false;
    let moved = 0;
    const watch = createRevisionWatch(
      async () => {
        if (fail) throw new Error('meta store down');
        return Promise.resolve(revision);
      },
      () => {
        moved += 1;
      },
    );
    await watch();
    expect(moved).toBe(0);
    await watch();
    expect(moved).toBe(0);
    revision = 4;
    await watch();
    expect(moved).toBe(1);
    fail = true;
    await watch();
    expect(moved).toBe(1);
    fail = false;
    await watch();
    expect(moved).toBe(1);
  });
});
