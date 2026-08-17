// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LLM provider-config helpers for the routes (06-llm-assist.md §3.2).
 *
 * Owns the three things `GET/PUT /config`, `POST /config/test` and `GET /models`
 * share: reading the `llm.*` settings into the safe reply shape (key redacted to
 * `apiKeySet` + last-4, acceptance #10), encrypting a new key on write (AES-256-GCM
 * via the injected {@link LlmKeyCrypto}), and resolving the active settings into a
 * live {@link ProviderClient} with the DECRYPTED key. The key never leaves this
 * module except inside the provider request header; nothing here logs it.
 */

import {
  createProviderClient,
  DEFAULT_MAX_OUTPUT_TOKENS,
  type LlmKeyCrypto,
  type ProviderClient,
  type ProviderConfig,
  type ProviderId,
} from '@adminium/llm';
import type { SettingsRepo } from '@adminium/meta';

import { guardOutboundUrl } from '../../connections/dsn.js';
import type { LlmConfigPutBody, LlmConfigReply } from './schema.js';

/** Loopback blocking mirrors the DSN guard: on only in production. */
function outboundGuardOpts() {
  return { blockLoopback: process.env.NODE_ENV === 'production' };
}

/** How many trailing characters of the key the safe reply exposes (§3.2). */
const KEY_LAST_N = 4;

/** Test seam — construct a client from a resolved config (default: real client). */
export type CreateClient = (config: ProviderConfig) => ProviderClient;

export interface ResolvedProviderClient {
  client: ProviderClient;
  provider: ProviderId;
  model: string;
  baseUrl: string | null;
}

/** No provider is configured yet — `POST /config/test` / `GET /models` can't run. */
export class ProviderNotConfiguredError extends Error {
  override readonly name = 'ProviderNotConfiguredError';
  constructor(message = 'No LLM provider is configured.') {
    super(message);
  }
}

/**
 * Decrypt a stored key. Tolerates a plaintext value (only decrypts recognizably
 * `enc:`-prefixed tokens) so a partially-migrated setting never throws — mirrors
 * `llm/provider-resolver.ts`.
 */
function decryptStoredKey(stored: string | null, keyCrypto: LlmKeyCrypto): string | null {
  if (stored === null || stored.length === 0) return null;
  return stored.startsWith('enc:') ? keyCrypto.decrypt(stored) : stored;
}

/** The safe `GET /config` view: provider/model/baseUrl + key presence, never the key. */
export async function readLlmConfig(
  settings: SettingsRepo,
  keyCrypto: LlmKeyCrypto,
): Promise<LlmConfigReply> {
  const [provider, model, baseUrl, storedKey, maxOutputTokens] = await Promise.all([
    settings.get('llm.provider'),
    settings.get('llm.model'),
    settings.get('llm.baseUrl'),
    settings.get('llm.apiKey'),
    settings.get('llm.maxOutputTokens'),
  ]);

  const plaintext = decryptStoredKey(storedKey, keyCrypto);
  const apiKeySet = plaintext !== null && plaintext.length > 0;
  return {
    provider,
    model,
    baseUrl,
    maxOutputTokens,
    apiKeySet,
    apiKeyLast4: apiKeySet ? plaintext.slice(-KEY_LAST_N) : null,
  };
}

export interface WriteLlmConfigContext {
  updatedBy: string | null;
  at: number;
}

/**
 * Persist a config write. `provider` is always set; `model`/`baseUrl`/
 * `maxOutputTokens` are set only when present in the body (absent ⇒ untouched).
 * The API key is AES-256-GCM-encrypted before storage; an empty-string `apiKey`
 * clears it; an absent `apiKey` leaves the stored key untouched (§3.2 — there is
 * no read-back, so the UI omits the field to keep the existing key).
 */
export async function writeLlmConfig(
  settings: SettingsRepo,
  keyCrypto: LlmKeyCrypto,
  body: LlmConfigPutBody,
  ctx: WriteLlmConfigContext,
): Promise<void> {
  const opts = { updatedBy: ctx.updatedBy, at: ctx.at };
  await settings.set('llm.provider', body.provider, opts);
  if (body.model !== undefined) await settings.set('llm.model', body.model, opts);
  if (body.baseUrl !== undefined) {
    // SSRF: reject a metadata/loopback baseUrl at write time so a bad value is
    // never stored (openai-compatible accepts an arbitrary baseUrl).
    if (body.baseUrl !== null && body.baseUrl.length > 0) {
      guardOutboundUrl(body.baseUrl, outboundGuardOpts());
    }
    await settings.set('llm.baseUrl', body.baseUrl, opts);
  }
  if (body.maxOutputTokens !== undefined) {
    await settings.set('llm.maxOutputTokens', body.maxOutputTokens, opts);
  }
  if (body.apiKey !== undefined) {
    // Empty string clears the key; otherwise store the AES-256-GCM token — never plaintext.
    const value = body.apiKey.length === 0 ? null : keyCrypto.encrypt(body.apiKey);
    await settings.set('llm.apiKey', value, opts);
  }
}

/**
 * Resolve the active `llm.*` settings into a live provider client with the
 * decrypted key. Throws {@link ProviderNotConfiguredError} when no provider is
 * set. The client construction may throw a `ProviderError` (e.g. missing key /
 * unsupported provider) — the caller maps it to a `{ ok:false, error }` reply.
 */
export async function resolveProviderClient(
  settings: SettingsRepo,
  keyCrypto: LlmKeyCrypto,
  createClient: CreateClient = createProviderClient,
): Promise<ResolvedProviderClient> {
  const [provider, model, baseUrl, storedKey, maxOut] = await Promise.all([
    settings.get('llm.provider'),
    settings.get('llm.model'),
    settings.get('llm.baseUrl'),
    settings.get('llm.apiKey'),
    settings.get('llm.maxOutputTokens'),
  ]);
  if (provider === null) throw new ProviderNotConfiguredError();

  const apiKey = decryptStoredKey(storedKey, keyCrypto);
  const config: ProviderConfig = {
    provider,
    model: model ?? '',
    maxOutputTokens: maxOut ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
  if (apiKey !== null) config.apiKey = apiKey;
  if (baseUrl !== null) {
    // SSRF: re-check at resolve time so an already-stored bad value (e.g. from
    // before this guard, or a direct settings write) cannot be dialed.
    guardOutboundUrl(baseUrl, outboundGuardOpts());
    config.baseUrl = baseUrl;
  }

  return { client: createClient(config), provider, model: model ?? '', baseUrl };
}
