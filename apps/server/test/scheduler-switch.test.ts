// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `ADMINIUM_SCHEDULER=off`: the server starts with neither the job scheduler
 * nor the job queue, so nothing that is due runs. An operator starts a copied
 * instance once with it to check the copy starts; a due job that ran there
 * would run again on the original.
 */
import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, jobsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { JobScheduler } from '../src/jobs/scheduler.js';
import { NOOP_PROGRESS_KIND } from '../src/jobs/registry.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

let composed: ComposedServer | undefined;

afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  vi.restoreAllMocks();
});

async function compose(env: Record<string, string>): Promise<{ meta: MetaDb; server: ComposedServer }> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const storeHandle: MetaStoreHandle = { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null });
  const runService = createRunService({ meta });
  composed = await composeServer({
    env: makeEnv(env),
    metaStore: storeHandle,
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
  });
  return { meta, server: composed };
}

/** A job due now, queued before the server is ready (as one left in a copied store would be). */
async function dueJob(meta: MetaDb): Promise<string> {
  const job = await jobsRepo(meta).enqueue({ kind: NOOP_PROGRESS_KIND, payload: { steps: 1 } });
  return job.id;
}

async function statusOf(meta: MetaDb, id: string): Promise<string | undefined> {
  return (await jobsRepo(meta).findById(id))?.status;
}

describe('ADMINIUM_SCHEDULER', () => {
  it('is on by default: the schedules start and a due job runs', async () => {
    const started = vi.spyOn(JobScheduler.prototype, 'start');
    const { meta, server } = await compose({});
    const id = await dueJob(meta);
    await server.app.ready();
    expect(started).toHaveBeenCalled();
    const deadline = Date.now() + 5000;
    while ((await statusOf(meta, id)) !== 'succeeded' && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
    expect(await statusOf(meta, id)).toBe('succeeded');
  });

  it('off: no schedule starts and a due job stays queued', async () => {
    const started = vi.spyOn(JobScheduler.prototype, 'start');
    const { meta, server } = await compose({ ADMINIUM_SCHEDULER: 'off' });
    const id = await dueJob(meta);
    await server.app.ready();
    await new Promise((done) => setTimeout(done, 300));
    expect(started).not.toHaveBeenCalled();
    expect(await statusOf(meta, id)).toBe('pending');
    // The server itself answers.
    const ready = await server.app.inject({ method: 'GET', url: '/api/v1/readyz' });
    expect(ready.statusCode).toBe(200);
  });
});
