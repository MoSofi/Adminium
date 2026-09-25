// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The whole server over an installed app's store, answering its public API
 * with the app's own key — for the tests of a person's own rows and of
 * signing in by an emailed link. Nothing below the HTTP route is faked: the
 * gate, the resolver, the scope compiler, the write service, the job queue.
 */
import { publicKeysRepo, settingsRepo } from '@adminium/meta';

import { composeServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { openPublishableKey } from '../src/public-api/keys.js';
import type { InvoicingHarness } from './invoicing-install.helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

export const ORIGIN = 'https://studio.example.com';

export type Served = Awaited<ReturnType<typeof servePublic>>;

/** The composed server, and requests through one of its keys. */
export async function servePublic(h: InvoicingHarness, keyId: string, env: Record<string, string> = {}) {
  await settingsRepo(h.meta).set('publicApi.enabled', true);
  const runService = createRunService({ meta: h.meta });
  const composed = await composeServer({
    env: makeEnv({ ADMINIUM_PUBLIC_API_ORIGINS: ORIGIN, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET, ...env }),
    metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager: h.manager,
    runService,
    applyService: createApplyService({ meta: h.meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
  });
  await composed.app.ready();
  // The test drives the jobs itself: no poll or tick may race it.
  await composed.jobs.worker.stop();
  composed.jobs.scheduler.stop();
  const tokenOf = async (id: string) => {
    const key = (await publicKeysRepo(h.meta).findById(id))!;
    return openPublishableKey(dsnCryptoFromSecret(TEST_SECRET), key.tokenEncrypted!);
  };
  let token = await tokenOf(keyId);
  const headers = (session?: string, extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${token}`,
    origin: ORIGIN,
    ...(session === undefined ? {} : { 'x-adminium-public-session': session }),
    ...extra,
  });
  const get = (url: string, session?: string) => composed.app.inject({ method: 'GET', url: `/api/v1/public${url}`, headers: headers(session) });
  const post = (url: string, payload: Record<string, unknown>, session?: string, extra: Record<string, string> = {}) =>
    composed.app.inject({ method: 'POST', url: `/api/v1/public${url}`, headers: headers(session, extra), payload });
  const codeOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string } }).error?.code;
  return {
    composed,
    headers,
    get,
    post,
    codeOf,
    /** Answer through another key from now on. */
    useKey: async (id: string) => {
      token = await tokenOf(id);
    },
    close: () => composed.app.close(),
  };
}
