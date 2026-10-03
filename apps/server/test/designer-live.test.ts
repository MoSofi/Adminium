// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The live Designer's switch.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LIVE_ID_FILE, createLive, type LiveDeps } from '../src/designer/live.js';
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
});
