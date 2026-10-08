// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The live Designer's switch.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LIVE_APPS_ID_FILE, LIVE_ID_FILE, createLive, type LiveDeps } from '../src/designer/live.js';
import { tempProject } from './app-project-helpers.js';

let root: string;
let stored: { on: boolean; id: string | null };
let logged: string[];
const live = (over: Partial<LiveDeps> = {}) =>
  createLive({
    root,
    allowed: true,
    settings: { get: async () => stored, set: async (value) => void (stored = value) },
    hasBundler: () => true,
    log: (message) => logged.push(message),
    ...over,
  });

beforeEach(() => {
  root = tempProject('adminium-designer-live-');
  stored = { on: false, id: null };
  logged = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the live Designer’s switch', () => {
  it('is off until the operator allowed it, a project is there, and somebody switched it on', async () => {
    expect(await live({ allowed: false }).state()).toEqual({ mode: 'live', allowed: false, on: false, project: true, reason: 'not-allowed' });
    expect(await live({ allowed: false }).set(true)).toBe('not-allowed');
    expect(await live({ root: null }).state()).toMatchObject({ on: false, project: false, reason: 'no-project' });
    expect(await live({ root: null }).set(true)).toBe('no-project');
    expect(await live({ hasBundler: () => false }).set(true)).toBe('no-bundler');
    expect(stored.on).toBe(false);

    const allowed = live();
    expect(await allowed.state()).toMatchObject({ allowed: true, on: false, reason: null });
    expect(await allowed.set(true)).toBeNull();
    expect(await allowed.state()).toMatchObject({ on: true, reason: null });
    expect(existsSync(join(root, LIVE_ID_FILE))).toBe(true);
    expect(stored.id).toMatch(/^[0-9a-f]{32}$/);
    // The operator takes the permission away: off again, whatever the switch says.
    expect(await live({ allowed: false }).state()).toMatchObject({ on: false, reason: 'not-allowed' });
    expect(await allowed.set(false)).toBeNull();
    expect(stored).toEqual({ on: false, id: null });
  });

  it('goes off at a boot that finds the folder was not kept, and says why until it is switched on again', async () => {
    const first = live();
    await first.set(true);
    await first.checkAtBoot();
    expect(stored.on).toBe(true);

    // The folder comes back without what was written into it.
    rmSync(join(root, '.adminium'), { recursive: true, force: true });
    const rebooted = live();
    await rebooted.checkAtBoot();
    expect(stored).toEqual({ on: false, id: null });
    expect(await rebooted.state()).toMatchObject({ on: false, reason: 'disk-not-kept' });
    expect(logged[0]).toContain('did not come back as it was left');
    expect(await rebooted.set(true)).toBeNull();
    expect(await rebooted.state()).toMatchObject({ on: true, reason: null });
  });

  it('writes its id where the apps are too, and goes off when that folder alone did not come back', async () => {
    const first = live();
    await first.set(true);
    const id = stored.id;
    const read = (file: string): unknown => JSON.parse(readFileSync(join(root, file), 'utf8'));
    expect(read(LIVE_APPS_ID_FILE)).toEqual({ id });
    expect(read(LIVE_ID_FILE)).toEqual({ id, places: ['apps'] });
    expect(await live().checkAtBoot()).toBe(false);

    // A host that keeps `.adminium/` and not `apps/`: what the Designer built is gone, though its own notes are there.
    rmSync(join(root, 'apps'), { recursive: true, force: true });
    const rebooted = live();
    expect(await rebooted.checkAtBoot()).toBe(true);
    expect(stored).toEqual({ on: false, id: null });
    expect(await rebooted.state()).toMatchObject({ on: false, reason: 'disk-not-kept' });

    // An id in `apps/` that is another switch's (a folder copied in from elsewhere) is no proof either.
    await rebooted.set(true);
    writeFileSync(join(root, LIVE_APPS_ID_FILE), JSON.stringify({ id: 'f'.repeat(32) }));
    expect(await live().checkAtBoot()).toBe(true);
  });

  it('a switch left on by a version that wrote one id stays on, and gets the second', async () => {
    await live().set(true);
    const id = stored.id as string;
    // As 0.3.17 left it: the one file, with the id alone.
    writeFileSync(join(root, LIVE_ID_FILE), `${JSON.stringify({ id }, null, 2)}\n`);
    rmSync(join(root, LIVE_APPS_ID_FILE), { force: true });
    expect(await live().checkAtBoot()).toBe(false);
    expect(stored).toEqual({ on: true, id });
    expect(JSON.parse(readFileSync(join(root, LIVE_APPS_ID_FILE), 'utf8'))).toEqual({ id });
    expect(JSON.parse(readFileSync(join(root, LIVE_ID_FILE), 'utf8'))).toEqual({ id, places: ['apps'] });
    // From then on both are asked for.
    rmSync(join(root, LIVE_APPS_ID_FILE), { force: true });
    expect(await live().checkAtBoot()).toBe(true);
  });
});
