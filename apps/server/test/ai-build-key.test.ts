// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `ADMINIUM_AI_BUILD_API_KEY`: the operator gateway's key for builds.
 *
 * A Designer run and the schema assistant (`POST /llm/runs` and its runs) on the operator's OpenAI-compatible
 * connection send the build key, at the same address and model; every other AI use (the page assistant, a test of a
 * connection, a picture) sends `ADMINIUM_AI_COMPATIBLE_API_KEY`. Unset, builds send the compatible key too. Both are
 * counted on the one operator meter.
 */
import { llmKeyCryptoFromSecret, type ProviderClient, type ProviderConfig, type ProviderRunner } from '@adminium/llm';
import { operatorTalliesRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { decryptSecret, deriveKey, encryptSecret } from '../src/config/secrets.js';
import { createAiEnv } from '../src/llm/ai-env.js';
import { createAiConnections } from '../src/llm/connections.js';
import { AI_TOKENS_TALLY, createOperatorAiMeter } from '../src/llm/operator-ai.js';
import { createProviderResolver } from '../src/llm/provider-resolver.js';
import { AVAILABLE, makeStore, type EngineName } from './archive.helpers.js';
import { TEST_SECRET } from './helpers.js';

let meta: MetaDb;
let destroy: () => Promise<void> = async () => undefined;
let configs: ProviderConfig[];

const fakeClient = (config: ProviderConfig): ProviderClient => {
  configs.push(config);
  return {
    id: config.provider,
    listModels: async () => [],
    complete: async () => ({ text: '{}', usage: { inputTokens: 10, outputTokens: 5 } }) as never,
    test: async () => ({ ok: true }) as never,
  };
};
const fakeRunner = (config: ProviderConfig): ProviderRunner => {
  configs.push(config);
  return { id: config.provider, run: async () => ({ blocks: [], stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 } }) as never };
};

const GATEWAY = {
  ADMINIUM_AI_COMPATIBLE_BASE_URL: 'https://gateway.example.com/v1',
  ADMINIUM_AI_COMPATIBLE_API_KEY: 'sk-normal',
  ADMINIUM_AI_MODEL: 'openai-compatible/house-model',
};

function connections(buildApiKey: string | undefined) {
  const operatorAi = createOperatorAiMeter(meta, { only: true, scope: 'dashboard', budget: 1_000_000, trial: true });
  return createAiConnections({
    settings: settingsRepo(meta),
    keyCrypto: llmKeyCryptoFromSecret(TEST_SECRET, { deriveKey, encryptSecret, decryptSecret }),
    aiEnv: createAiEnv({ root: null, fromEnvironment: GATEWAY }),
    networkFeatures: true,
    production: false,
    createClient: fakeClient,
    createRunner: fakeRunner,
    resolve: async () => ['93.184.216.34'],
    operatorAi,
    buildApiKey,
  });
}

describe.each((['sqlite', 'postgres', 'mysql'] as EngineName[]).filter((engine) => AVAILABLE[engine]))('ADMINIUM_AI_BUILD_API_KEY [%s]', { timeout: 120_000 }, (engine) => {
  // One store for the file's tests: what they write (a saved key, last) does not reach the ones before it.
  beforeAll(async () => {
    ({ meta, destroy } = await makeStore(engine, true));
  }, 180_000);
  afterAll(async () => {
    await destroy();
  });
  beforeEach(() => {
    configs = [];
  });

  it('a Designer run and a schema-assistant run carry the build key; every other use carries the normal key', async () => {
    const ai = connections('sk-build');
    // The Designer's runner (`designer/service.ts` asks for a build).
    await ai.runner('env:openai-compatible', 'house-model', { purpose: 'build' });
    // The schema assistant's client, as its run resolver asks for it.
    const resolve = createProviderResolver({ meta, keyCrypto: llmKeyCryptoFromSecret(TEST_SECRET, { deriveKey, encryptSecret, decryptSecret }), allowedTemplates: [], allowedWidgets: [], connections: ai });
    await resolve({ id: 'run-1', provider: 'openai-compatible', model: 'house-model', snapshotId: 'none', locales: ['en_US'] } as never).catch(() => undefined);
    // The page assistant and anything else: no purpose.
    await ai.client('env:openai-compatible', 'house-model');
    await ai.clientForProvider('openai-compatible', 'house-model');
    await ai.runner('env:openai-compatible', 'house-model');

    expect(configs.map((config) => config.apiKey)).toEqual(['sk-build', 'sk-build', 'sk-normal', 'sk-normal', 'sk-normal']);
    // Same address and model either way.
    expect(new Set(configs.map((config) => config.baseUrl))).toEqual(new Set(['https://gateway.example.com/v1']));
    expect(new Set(configs.map((config) => config.model))).toEqual(new Set(['house-model']));
  });

  it('unset, a build carries the normal key', async () => {
    const ai = connections(undefined);
    await ai.runner('env:openai-compatible', 'house-model', { purpose: 'build' });
    await ai.clientForProvider('openai-compatible', 'house-model', { purpose: 'build' });
    expect(configs.map((config) => config.apiKey)).toEqual(['sk-normal', 'sk-normal']);
  });

  it('a build on the build key is counted on the same operator meter', async () => {
    const ai = connections('sk-build');
    const resolved = await ai.clientForProvider('openai-compatible', 'house-model', { purpose: 'build' });
    await resolved.client.complete({ system: 'x', messages: [{ role: 'user', content: 'hello' }], maxTokens: 50 } as never);
    expect((await operatorTalliesRepo(meta).get(AI_TOKENS_TALLY))?.amount).toBe(15);
  });

  it('the person’s own saved key is never swapped for the build key', async () => {
    const ai = connections('sk-build');
    const settings = settingsRepo(meta);
    await settings.set('llm.provider', 'openai-compatible');
    await settings.set('llm.baseUrl', 'https://their-own.example.com/v1');
    await settings.set('llm.apiKey', 'sk-theirs');
    await settings.set('llm.model', 'their-model');
    await ai.clientForProvider('openai-compatible', 'their-model', { purpose: 'build' });
    expect(configs.at(-1)?.apiKey).toBe('sk-theirs');
  });
});
