// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Production {@link ResolveRun} — turns a persisted run into a live provider
 * client with the DECRYPTED API key (acceptance).
 *
 * It reads the `llm.*` settings (`provider`/`apiKey`/`baseUrl`/`model`/
 * `maxOutputTokens`), decrypts `llm.apiKey` through the injected
 * {@link LlmKeyCrypto} (the AES-256-GCM closure built from `ADMINIUM_SECRET` via
 * `@adminium/llm`'s `llmKeyCryptoFromSecret`), loads the run's snapshot IR for the
 * validation context, and builds the client via `@adminium/llm`'s
 * `createProviderClient`. The provider/model come from the RUN row (captured at
 * `createRun`), so a later settings change never silently retargets an in-flight
 * run; the key/baseUrl/budget come from live settings.
 *
 * The allow-lists (`LLM_ALLOWED_TEMPLATES` / `LLM_ALLOWED_WIDGETS` from
 * `@adminium/widgets`) are INJECTED rather than imported so the server tree keeps
 * no dependency on the widgets package — the integrator (app wiring) supplies
 * them, exactly as it supplies the key crypto.
 */
import type { AiConnections } from './connections.js';
import type { DatabaseModel } from '@adminium/engine';
import {
  createProviderClient,
  DEFAULT_MAX_OUTPUT_TOKENS,
  ProviderError,
  validateResponse,
  type LlmKeyCrypto,
  type LocaleCode,
  type ProviderClient,
  type ProviderConfig,
  type ProviderId,
  type ValidationResult,
} from '@adminium/llm';
import { settingsRepo, snapshotsRepo, type LlmRun, type MetaDb } from '@adminium/meta';

import type { ResolvedRun, ResolveRun } from '../jobs/llm-run.js';

/**
 * Per-provider `maxTokens` ceiling the `LLM_TRUNCATED` escalation raises to
 * before counting a repair. Conservative output caps for the chat contract
 * each client speaks; a truncated reply retries once at this budget.
 */
export const PROVIDER_OUTPUT_CEILING: Record<ProviderId, number> = {
  anthropic: 64_000,
  openai: 16_384,
  'openai-compatible': 32_000,
  ollama: 32_000,
  'adminium-managed': 64_000,
};

export interface ProviderResolverDeps {
  meta: MetaDb;
  /** Decrypts the stored `llm.apiKey` (`enc:v1:` token → plaintext). */
  keyCrypto: LlmKeyCrypto;
  /** `LLM_ALLOWED_TEMPLATES` from `@adminium/widgets`. */
  allowedTemplates: readonly string[];
  /** `LLM_ALLOWED_WIDGETS` from `@adminium/widgets`. */
  allowedWidgets: readonly string[];
  /** Bundled lucide manifest for the icon-fallback warning (optional). */
  allowedIcons?: ReadonlySet<string> | readonly string[];
  /** Test seam — construct a client from a config (default: `createProviderClient`). */
  createClient?: (config: ProviderConfig) => ProviderClient;
  /**
   * The instance's model connections. When given, a run's client comes from
   * the connection of the provider it recorded — the database's, else the
   * environment's — with the address checked before it is dialled. Absent in
   * harnesses that read the settings directly.
   */
  connections?: AiConnections | undefined;
}

/** Build the production run resolver. */
export function createProviderResolver(deps: ProviderResolverDeps): ResolveRun {
  const settings = settingsRepo(deps.meta);
  const snapshots = snapshotsRepo(deps.meta);
  const makeClient = deps.createClient ?? createProviderClient;

  return async (run: LlmRun): Promise<ResolvedRun> => {
    if (run.provider === null) {
      throw new ProviderError({
        provider: 'anthropic',
        code: 'config',
        message: `run ${run.id} has no provider recorded`,
      });
    }
    const provider = run.provider as ProviderId;

    const snapshotOf = async (): Promise<DatabaseModel> => {
      const snapshot = await snapshots.findById(run.snapshotId);
      if (snapshot === null) {
        throw new ProviderError({
          provider,
          code: 'config',
          message: `run ${run.id} references a missing snapshot ${run.snapshotId}`,
        });
      }
      return snapshot.schema as DatabaseModel;
    };
    const validatorFor = (schemaIr: DatabaseModel) => (rawText: string): ValidationResult =>
      validateResponse(rawText, {
        snapshot: schemaIr,
        locales: (run.locales ?? ['en_US']) as LocaleCode[],
        allowedTemplates: deps.allowedTemplates,
        allowedWidgets: deps.allowedWidgets,
        ...(deps.allowedIcons !== undefined ? { allowedIcons: deps.allowedIcons } : {}),
        runId: run.id,
      });

    if (deps.connections !== undefined) {
      const resolved = await deps.connections.clientForProvider(provider, run.model);
      return {
        client: resolved.client,
        provider,
        model: resolved.model,
        maxTokens: resolved.maxOutputTokens,
        maxTokensCeiling: Math.max(resolved.maxOutputTokens, PROVIDER_OUTPUT_CEILING[provider]),
        validate: validatorFor(await snapshotOf()),
      };
    }

    const [storedKey, baseUrl, settingModel, maxOut] = await Promise.all([
      settings.get('llm.apiKey'),
      settings.get('llm.baseUrl'),
      settings.get('llm.model'),
      settings.get('llm.maxOutputTokens'),
    ]);

    const apiKey = decryptKey(storedKey, deps.keyCrypto);
    const model = run.model ?? settingModel ?? '';
    const maxTokens = maxOut ?? DEFAULT_MAX_OUTPUT_TOKENS;

    const config: ProviderConfig = { provider, model, maxOutputTokens: maxTokens };
    if (apiKey !== undefined) config.apiKey = apiKey;
    if (baseUrl !== null) config.baseUrl = baseUrl;
    const client = makeClient(config);

    const validate = validatorFor(await snapshotOf());

    return {
      client,
      provider,
      model,
      maxTokens,
      maxTokensCeiling: Math.max(maxTokens, PROVIDER_OUTPUT_CEILING[provider]),
      validate,
    };
  };
}

/**
 * Decrypt the stored key. Tolerates a plaintext value (the settings-secret write
 * path is still landing) by only decrypting recognizably-encrypted `enc:` tokens.
 */
function decryptKey(stored: string | null, crypto: LlmKeyCrypto): string | undefined {
  if (stored === null || stored.length === 0) return undefined;
  return stored.startsWith('enc:') ? crypto.decrypt(stored) : stored;
}
