// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A trial's Designer switched on at its first boot (W2), and the build box's operator variables, which no folder
 * decides.
 *
 *  - Trial mode with `ADMINIUM_DESIGNER=live`: the first boot switches it on, once, audited as the operator.
 *  - A Super Admin's later "off" stands across restarts; an ordinary or hosted server is never switched.
 *  - A switch that cannot go on (no bundler) gives its claim back, so a later boot tries again.
 *  - Every new operator variable is on OPERATOR_DECIDED_ENV and HOST_DECIDED_ENV, and a folder's `.env` cannot set one.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditRepo, operatorTalliesRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OPERATOR_DECIDED_ENV } from '../src/config/env.js';
import { HOST_DECIDED_ENV } from '../src/config/host-decided.js';
import { createLive, type Live } from '../src/designer/live.js';
import { LIVE_FIRST_BOOT_TALLY, switchLiveOnFirstBoot } from '../src/designer/live-first-boot.js';
import { prepareProject } from '../src/project/boot.js';
import { AVAILABLE, makeStore, type EngineName } from './archive.helpers.js';

const ENGINES = (['sqlite', 'postgres', 'mysql'] as EngineName[]).filter((engine) => AVAILABLE[engine]);

describe.each(ENGINES)('a trial’s Designer at its first boot [%s]', { timeout: 60_000 }, (engine) => {
  let meta: MetaDb;
  let destroy: () => Promise<void> = async () => undefined;
  let root: string;
  let stored: { on: boolean; id: string | null };
  beforeEach(async () => {
    ({ meta, destroy } = await makeStore(engine, true));
    root = mkdtempSync(join(tmpdir(), 'adminium-live-first-boot-'));
    stored = { on: false, id: null };
  });
  afterEach(async () => {
    await destroy();
    rmSync(root, { recursive: true, force: true });
  });

  const liveOf = (opts: { allowed?: boolean; bundler?: boolean } = {}): Live =>
    createLive({
      root,
      allowed: opts.allowed ?? true,
      settings: {
        get: async () => ({ ...stored }),
        set: async (value) => {
          stored = { ...value };
        },
      },
      hasBundler: () => opts.bundler ?? true,
      log: () => undefined,
    });

  /** One boot: the check, then the first-boot switch, as `compose.ts` runs them. */
  const boot = async (live: Live, profile: 'trial' | 'hosted' | 'off' = 'trial') => {
    await live.checkAtBoot();
    return switchLiveOnFirstBoot({ live, meta, profile });
  };

  it('switches it on once, audited as the operator, and never again after a Super Admin’s off', async () => {
    expect(await boot(liveOf())).toEqual({ kind: 'switched-on' });
    expect(stored.on).toBe(true);
    const audit = (await auditRepo(meta).list({ limit: 10 })).filter((entry) => entry.action === 'designer.live.on');
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorKind).toBe('system');
    expect(audit[0]?.actorLabel).toBe('Server operator');

    // The next boot finds it on and leaves it.
    expect(await boot(liveOf())).toEqual({ kind: 'skipped' });
    expect(stored.on).toBe(true);

    // The Super Admin switches it off: every later boot respects it.
    await liveOf().set(false);
    for (let n = 0; n < 2; n += 1) expect(await boot(liveOf())).toEqual({ kind: 'skipped' });
    expect(stored.on).toBe(false);
    expect((await auditRepo(meta).list({ limit: 10 })).filter((entry) => entry.action === 'designer.live.on')).toHaveLength(1);
  });

  it('is never switched on an ordinary or hosted server, nor where the operator does not allow it', async () => {
    expect(await boot(liveOf(), 'off')).toEqual({ kind: 'skipped' });
    expect(await boot(liveOf(), 'hosted')).toEqual({ kind: 'skipped' });
    expect(await boot(liveOf({ allowed: false }))).toEqual({ kind: 'skipped' });
    expect(stored.on).toBe(false);
    expect(await operatorTalliesRepo(meta).get(LIVE_FIRST_BOOT_TALLY)).toBeNull();
  });

  it('a switch that cannot go on gives the claim back, and a later boot that can switches it on', async () => {
    expect(await boot(liveOf({ bundler: false }))).toEqual({ kind: 'refused', reason: 'no-bundler' });
    expect(await operatorTalliesRepo(meta).get(LIVE_FIRST_BOOT_TALLY)).toBeNull();
    expect(await boot(liveOf())).toEqual({ kind: 'switched-on' });
  });

  it('already on: the claim is kept and nothing is switched or audited', async () => {
    await liveOf().set(true);
    expect(await boot(liveOf())).toEqual({ kind: 'already-on' });
    expect((await auditRepo(meta).list({ limit: 10 })).filter((entry) => entry.action === 'designer.live.on')).toHaveLength(0);
    await liveOf().set(false);
    expect(await boot(liveOf())).toEqual({ kind: 'skipped' });
  });
});

describe('the build box’s operator variables', () => {
  const NEW_NAMES = ['ADMINIUM_OPERATOR_PROJECT', 'ADMINIUM_YOUR_DATABASE', 'ADMINIUM_DATABASE_USER_HOST', 'ADMINIUM_DATABASE_DENY_ADDRESSES', 'ADMINIUM_AI_BUILD_API_KEY'];

  it('are each the operator’s word: on OPERATOR_DECIDED_ENV and HOST_DECIDED_ENV', () => {
    for (const name of NEW_NAMES) {
      expect(OPERATOR_DECIDED_ENV as readonly string[], name).toContain(name);
      expect(HOST_DECIDED_ENV, name).toContain(name);
    }
    // Every name on the list is host-decided, the new ones included.
    for (const name of OPERATOR_DECIDED_ENV) expect(HOST_DECIDED_ENV, name).toContain(name);
  });

  it('a folder’s .env or config sets none of them where the host decides', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adminium-build-box-env-'));
    try {
      writeFileSync(join(root, 'adminium.config.mjs'), 'export default {};\n');
      writeFileSync(join(root, 'package.json'), '{"name":"p","private":true,"type":"module"}\n');
      const values: Record<string, string> = {
        ADMINIUM_OPERATOR_PROJECT: 'on',
        ADMINIUM_YOUR_DATABASE: '{"url":"postgres://u:p@db.example.com:5432/d"}',
        ADMINIUM_DATABASE_USER_HOST: 'db.example.com:5432',
        ADMINIUM_DATABASE_DENY_ADDRESSES: '203.0.113.7',
        ADMINIUM_AI_BUILD_API_KEY: 'sk-from-a-folder',
      };
      writeFileSync(join(root, '.env'), `${Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n')}\n`);
      const env: Record<string, string | undefined> = { PATH: process.env.PATH };
      const prepared = await prepareProject({ cwd: root, env, version: '0.0.0', refuse: HOST_DECIDED_ENV });
      for (const name of Object.keys(values)) {
        expect(env[name], name).toBeUndefined();
        expect(prepared?.env[name], name).toBeUndefined();
        expect(prepared?.refused, name).toContain(name);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
