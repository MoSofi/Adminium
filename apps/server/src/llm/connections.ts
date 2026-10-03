// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The models this instance can call, and the one place that resolves them.
 *
 * A connection is a provider with what it needs to be reached. There are two
 * kinds: the one saved in Settings → AI (the database: one provider, its key
 * encrypted), and the ones the environment names (`ADMINIUM_AI_*`: one per
 * provider). Everything that calls a model asks here, so three rules hold
 * everywhere instead of in whichever path remembered them:
 *
 *   - the address is checked before it is dialled, whichever path asks;
 *   - with network features off, only a local model is called;
 *   - a key is read where the call is made and returned to nobody.
 *
 * The page assistant and the enrichment runs use the database's connection
 * when one is saved, and fall back to the environment's selected model when
 * none is. The Designer names the connection it wants.
 */
import {
  canBuild,
  createProviderClient,
  createProviderRunner,
  DEFAULT_MAX_OUTPUT_TOKENS,
  ProviderError,
  type CanBuild,
  type LlmKeyCrypto,
  type ModelInfo,
  type ProviderClient,
  type ProviderConfig,
  type ProviderId,
  type ProviderRunner,
} from '@adminium/llm';
import type { SettingsRepo } from '@adminium/meta';

import { guardOutboundUrl } from '../connections/dsn.js';
import { ValidationFailedError } from '../errors.js';
import type { AiEnv, AiEnvName, AiEnvValues } from './ai-env.js';
import { resolveAndCheck, type ResolveCheckOptions } from './outbound.js';

/** The providers the environment can name. */
export const ENV_PROVIDERS = ['anthropic', 'openai', 'openai-compatible', 'ollama'] as const;
export type EnvProvider = (typeof ENV_PROVIDERS)[number];

export type ConnectionId = 'database' | `env:${EnvProvider}`;

export interface AiConnection {
  id: ConnectionId;
  provider: ProviderId;
  source: 'database' | 'environment';
  baseUrl: string | null;
  hasKey: boolean;
  /** The model this connection uses when none is named, or null. */
  model: string | null;
}

export interface ResolvedClient {
  client: ProviderClient;
  provider: ProviderId;
  model: string;
  baseUrl: string | null;
  maxOutputTokens: number;
}

export interface ResolvedRunner {
  runner: ProviderRunner;
  provider: ProviderId;
  model: string;
  connectionId: ConnectionId;
}

/** Why no model may be called. */
export type ConnectionRefusal = 'no-provider' | 'network-disabled';

/** What a person typed into the "Add a model" form. A field left out means the saved one. */
export interface ConnectionDraft {
  provider: EnvProvider;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  model?: string | undefined;
}

export interface ConnectionTest {
  ok: boolean;
  models: ModelInfo[];
  /** Whether the named model can be built with; null when no model was named or the test did not get that far (a model that could not be asked fails the test). */
  canBuild: Exclude<CanBuild, { reason: 'error' }> | null;
  error: { code: string; message: string } | null;
}

export interface AiConnections {
  list(): Promise<AiConnection[]>;
  find(id: string): Promise<AiConnection | null>;
  /** The connection and model the page assistant and enrichment use, or null. */
  default(): Promise<{ connection: AiConnection; model: string | null } | null>;
  /** The environment's selected model as written (`<provider>/<model>`), or null. */
  selected(): string | null;
  shadowed(): AiEnvName[];
  refusal(connection: AiConnection | null): ConnectionRefusal | null;
  /** A `complete()` client. `provider` picks the connection for a run that recorded which provider it was made for. */
  client(id: ConnectionId, model?: string | null): Promise<ResolvedClient>;
  clientForProvider(provider: ProviderId, model?: string | null): Promise<ResolvedClient>;
  runner(id: ConnectionId, model: string): Promise<ResolvedRunner>;
  models(id: ConnectionId): Promise<{ models: ModelInfo[]; source: 'live' | 'static' }>;
  /** Try what the form holds, without saving it. */
  test(draft: ConnectionDraft, opts?: { signal?: AbortSignal }): Promise<ConnectionTest>;
  /** Save what the form holds to the project's `.env` and select its model. */
  save(draft: ConnectionDraft & { model: string }): Promise<AiConnection>;
  /** The last `canBuild` verdict for a model, or null when it was never tested in this process. */
  verdict(id: ConnectionId, model: string): CanBuild | null;
  /** Whether a model can be built with: the verdict this process already has, else a round trip, kept. */
  canBuildWith(id: ConnectionId, model: string): Promise<CanBuild>;
  readonly envWritable: boolean;
}

export interface AiConnectionsDeps {
  settings: SettingsRepo;
  keyCrypto: LlmKeyCrypto;
  aiEnv: AiEnv;
  networkFeatures: boolean;
  /** `NODE_ENV === 'production'`: the database connection may not point at loopback there. */
  production: boolean;
  /** Refuse private addresses too: a server on the internet running the Designer for others (M4). */
  blockPrivate?: boolean;
  createClient?: (config: ProviderConfig) => ProviderClient;
  createRunner?: (config: ProviderConfig) => ProviderRunner;
  resolve?: ResolveCheckOptions['resolve'];
}

const KEY_NAME: Record<EnvProvider, AiEnvName | null> = {
  anthropic: 'ADMINIUM_AI_ANTHROPIC_API_KEY',
  openai: 'ADMINIUM_AI_OPENAI_API_KEY',
  'openai-compatible': 'ADMINIUM_AI_COMPATIBLE_API_KEY',
  ollama: null,
};
const URL_NAME: Record<EnvProvider, AiEnvName | null> = {
  anthropic: null,
  openai: null,
  'openai-compatible': 'ADMINIUM_AI_COMPATIBLE_BASE_URL',
  ollama: 'ADMINIUM_AI_OLLAMA_BASE_URL',
};

const isEnvProvider = (value: string): value is EnvProvider => (ENV_PROVIDERS as readonly string[]).includes(value);

/** `<provider>/<model>`, split. A model name may itself have slashes in it. */
export function parseSelected(value: string | undefined): { provider: EnvProvider; model: string } | null {
  if (value === undefined) return null;
  const at = value.indexOf('/');
  if (at <= 0) return null;
  const provider = value.slice(0, at);
  const model = value.slice(at + 1).trim();
  return isEnvProvider(provider) && model.length > 0 ? { provider, model } : null;
}

/** Whether the environment names this provider at all. */
function envHas(values: AiEnvValues, provider: EnvProvider): boolean {
  if (provider === 'anthropic') return values.ADMINIUM_AI_ANTHROPIC_API_KEY !== undefined;
  if (provider === 'openai') return values.ADMINIUM_AI_OPENAI_API_KEY !== undefined;
  if (provider === 'openai-compatible') return values.ADMINIUM_AI_COMPATIBLE_BASE_URL !== undefined;
  return values.ADMINIUM_AI_OLLAMA_BASE_URL !== undefined;
}

function decrypt(stored: string | null, keyCrypto: LlmKeyCrypto): string | null {
  if (stored === null || stored.length === 0) return null;
  return stored.startsWith('enc:') ? keyCrypto.decrypt(stored) : stored;
}

export function createAiConnections(deps: AiConnectionsDeps): AiConnections {
  const { settings, aiEnv } = deps;
  const makeClient = deps.createClient ?? createProviderClient;
  const makeRunner = deps.createRunner ?? createProviderRunner;
  const verdicts = new Map<string, CanBuild>();

  function envConnection(values: AiEnvValues, provider: EnvProvider): AiConnection {
    const urlName = URL_NAME[provider];
    const keyName = KEY_NAME[provider];
    const selected = parseSelected(values.ADMINIUM_AI_MODEL);
    return {
      id: `env:${provider}`,
      provider,
      source: 'environment',
      baseUrl: urlName === null ? null : (values[urlName] ?? null),
      hasKey: keyName !== null && values[keyName] !== undefined,
      model: selected?.provider === provider ? selected.model : null,
    };
  }

  async function databaseConnection(): Promise<AiConnection | null> {
    const provider = await settings.get('llm.provider');
    if (provider === null) return null;
    const [model, baseUrl, storedKey] = await Promise.all([settings.get('llm.model'), settings.get('llm.baseUrl'), settings.get('llm.apiKey')]);
    const key = decrypt(storedKey, deps.keyCrypto);
    return { id: 'database', provider, source: 'database', baseUrl, hasKey: key !== null && key.length > 0, model };
  }

  async function list(): Promise<AiConnection[]> {
    const values = aiEnv.read();
    const database = await databaseConnection();
    return [...(database === null ? [] : [database]), ...ENV_PROVIDERS.filter((provider) => envHas(values, provider)).map((provider) => envConnection(values, provider))];
  }

  function refusal(connection: AiConnection | null): ConnectionRefusal | null {
    if (connection === null) return 'no-provider';
    // Ollama is the local one: an instance with no outbound network can still use it.
    if (!deps.networkFeatures && connection.provider !== 'ollama') return 'network-disabled';
    return null;
  }

  /**
   * The check every call goes through: the address by name, then by what the
   * name resolves to, then whether this instance may reach a cloud at all.
   */
  async function guard(provider: ProviderId, baseUrl: string | null, source: AiConnection['source']): Promise<void> {
    if (!deps.networkFeatures && provider !== 'ollama') {
      throw new ProviderError({
        provider,
        code: 'config',
        message: `${provider}: outside network use is switched off on this server (ADMINIUM_NETWORK_FEATURES), so only a local model can be called`,
      });
    }
    if (baseUrl === null) return;
    // The operator named an environment address themselves; the database's can come from a form or an import.
    const blockLoopback = source === 'database' && provider !== 'ollama' && deps.production;
    guardOutboundUrl(baseUrl, { blockLoopback });
    await resolveAndCheck(baseUrl, {
      blockPrivate: deps.blockPrivate === true && provider !== 'ollama',
      ...(deps.resolve === undefined ? {} : { resolve: deps.resolve }),
    });
  }

  /** What a provider is built with. The one place a key is read. */
  async function configFor(id: ConnectionId, model: string | null | undefined): Promise<{ config: ProviderConfig; connection: AiConnection; maxOutputTokens: number }> {
    if (id === 'database') {
      const connection = await databaseConnection();
      if (connection === null) throw new ProviderNotConfiguredError();
      const [storedKey, maxOut] = await Promise.all([settings.get('llm.apiKey'), settings.get('llm.maxOutputTokens')]);
      const apiKey = decrypt(storedKey, deps.keyCrypto);
      const maxOutputTokens = maxOut ?? DEFAULT_MAX_OUTPUT_TOKENS;
      await guard(connection.provider, connection.baseUrl, 'database');
      return {
        connection,
        maxOutputTokens,
        config: {
          provider: connection.provider,
          model: model ?? connection.model ?? '',
          maxOutputTokens,
          ...(apiKey === null ? {} : { apiKey }),
          ...(connection.baseUrl === null ? {} : { baseUrl: connection.baseUrl }),
        },
      };
    }
    const provider = id.slice(4) as EnvProvider;
    const values = aiEnv.read();
    if (!isEnvProvider(provider) || !envHas(values, provider)) throw new ProviderNotConfiguredError(`No model connection "${id}" is set in the environment.`);
    const connection = envConnection(values, provider);
    const keyName = KEY_NAME[provider];
    const apiKey = keyName === null ? undefined : values[keyName];
    await guard(provider, connection.baseUrl, 'environment');
    return {
      connection,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      config: {
        provider,
        model: model ?? connection.model ?? '',
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(connection.baseUrl === null ? {} : { baseUrl: connection.baseUrl }),
      },
    };
  }

  async function client(id: ConnectionId, model?: string | null): Promise<ResolvedClient> {
    const { config, connection, maxOutputTokens } = await configFor(id, model);
    return { client: makeClient(config), provider: connection.provider, model: config.model ?? '', baseUrl: connection.baseUrl, maxOutputTokens };
  }

  /** The draft as a provider configuration, with what was left out taken from what is saved. */
  function draftConfig(draft: ConnectionDraft): { config: ProviderConfig; baseUrl: string | null } {
    const values = aiEnv.read();
    const keyName = KEY_NAME[draft.provider];
    const urlName = URL_NAME[draft.provider];
    const apiKey = draft.apiKey !== undefined && draft.apiKey !== '' ? draft.apiKey : keyName === null ? undefined : values[keyName];
    const baseUrl = draft.baseUrl !== undefined && draft.baseUrl !== '' ? draft.baseUrl : urlName === null ? undefined : values[urlName];
    return {
      baseUrl: baseUrl ?? null,
      config: {
        provider: draft.provider,
        model: draft.model ?? '',
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(baseUrl === undefined ? {} : { baseUrl }),
      },
    };
  }

  return {
    list,
    async find(id) {
      return (await list()).find((connection) => connection.id === id) ?? null;
    },
    async default() {
      const database = await databaseConnection();
      if (database !== null) return { connection: database, model: database.model };
      const values = aiEnv.read();
      const selected = parseSelected(values.ADMINIUM_AI_MODEL);
      if (selected === null || !envHas(values, selected.provider)) return null;
      return { connection: envConnection(values, selected.provider), model: selected.model };
    },
    selected: () => aiEnv.read().ADMINIUM_AI_MODEL ?? null,
    shadowed: () => aiEnv.shadowed(),
    refusal,
    client,
    async clientForProvider(provider, model) {
      const database = await databaseConnection();
      if (database?.provider === provider) return client('database', model);
      if (isEnvProvider(provider) && envHas(aiEnv.read(), provider)) return client(`env:${provider}`, model);
      // Nothing matches: the database's own error says what is missing.
      return client('database', model);
    },
    async runner(id, model) {
      const { config, connection } = await configFor(id, model);
      return { runner: makeRunner(config), provider: connection.provider, model, connectionId: connection.id };
    },
    async models(id) {
      const resolved = await client(id);
      try {
        return { models: await resolved.client.listModels(), source: 'live' };
      } catch (error) {
        if (error instanceof ProviderError) return { models: [], source: 'static' };
        throw error;
      }
    },
    async test(draft, opts = {}) {
      const { config, baseUrl } = draftConfig(draft);
      try {
        await guard(draft.provider, baseUrl, 'environment');
        const models = await makeClient(config).listModels();
        if (draft.model === undefined || draft.model === '') return { ok: true, models, canBuild: null, error: null };
        const verdict = await canBuild(makeRunner(config), draft.model, opts.signal === undefined ? {} : { signal: opts.signal });
        // The model could not be asked (a refused key shows here: the list above falls back to a built-in one): the test failed.
        if (!verdict.canBuild && verdict.reason === 'error') return { ok: false, models: [], canBuild: null, error: { code: verdict.code, message: verdict.message } };
        verdicts.set(`env:${draft.provider}\u0000${draft.model}`, verdict);
        return { ok: true, models, canBuild: verdict, error: null };
      } catch (error) {
        if (error instanceof ProviderError) return { ok: false, models: [], canBuild: null, error: { code: error.code, message: error.message } };
        if (error instanceof ValidationFailedError) return { ok: false, models: [], canBuild: null, error: { code: 'config', message: error.message } };
        throw error;
      }
    },
    async save(draft) {
      const keyName = KEY_NAME[draft.provider];
      const urlName = URL_NAME[draft.provider];
      const touched = [keyName, urlName, 'ADMINIUM_AI_MODEL' as const].filter((name): name is AiEnvName => name !== null);
      if (!aiEnv.writable) {
        throw new ValidationFailedError('This server has no project folder to keep a model in. Set the ADMINIUM_AI_* variables in its environment.', {
          reason: 'ENV_NOT_WRITABLE',
        });
      }
      // A value the operator set in the real environment wins over the file: writing it here would change nothing, silently.
      const outside = aiEnv.fromOperator().filter((name) => touched.includes(name));
      if (outside.length > 0) {
        throw new ValidationFailedError(
          `${outside.join(', ')} is set in this server's own environment, which wins over the project's .env. Change it there.`,
          { reason: 'ENV_SHADOWED', names: outside },
        );
      }
      const { baseUrl } = draftConfig(draft);
      await guard(draft.provider, baseUrl, 'environment');
      const values: Partial<Record<AiEnvName, string | null>> = { ADMINIUM_AI_MODEL: `${draft.provider}/${draft.model}` };
      if (keyName !== null && draft.apiKey !== undefined && draft.apiKey !== '') values[keyName] = draft.apiKey;
      if (urlName !== null && draft.baseUrl !== undefined && draft.baseUrl !== '') values[urlName] = draft.baseUrl;
      aiEnv.write(values);
      const now = aiEnv.read();
      if (!envHas(now, draft.provider)) {
        throw new ValidationFailedError('That connection needs its key or its address before it can be saved.', { reason: 'CONNECTION_INCOMPLETE' });
      }
      return envConnection(now, draft.provider);
    },
    verdict: (id, model) => verdicts.get(`${id}\u0000${model}`) ?? null,
    async canBuildWith(id, model) {
      const known = verdicts.get(`${id}\u0000${model}`);
      if (known !== undefined) return known;
      const { config } = await configFor(id, model);
      const verdict = await canBuild(makeRunner(config), model);
      // An error is not kept: the next try may reach the server.
      if (verdict.canBuild || verdict.reason !== 'error') verdicts.set(`${id}\u0000${model}`, verdict);
      return verdict;
    },
    envWritable: aiEnv.writable,
  };
}

/** No provider is configured: nothing can be tested, listed or called. */
export class ProviderNotConfiguredError extends Error {
  override readonly name = 'ProviderNotConfiguredError';
  constructor(message = 'No LLM provider is configured.') {
    super(message);
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The models this instance can call. Absent in a harness that composes no AI layer. */
    aiConnections: AiConnections;
  }
}
