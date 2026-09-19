// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LLM provider-config helpers for the routes.
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

import { guardOutboundUrl, type DsnGuardOptions } from '../../connections/dsn.js';
import type { LlmConfigPutBody, LlmConfigReply } from './schema.js';

/**
 * Loopback policy for the provider `baseUrl`. Cloud-metadata endpoints are
 * refused unconditionally inside the guard itself; this decides loopback only.
 *
 * `ollama` is carved out, because it is DEFINED as a local endpoint ("`baseUrl`
 * default `http://localhost:11434`") and `createOllamaClient` falls back to that
 * exact address when nothing is stored — down a path {@link
 * resolveProviderClient} never guards, since it skips the check when `baseUrl`
 * is null. Blocking loopback here therefore refuses the explicit spelling of a
 * dial the code already performs implicitly: it stops no attacker, and makes the
 * one keyless, no-cloud, no-network provider the single one an install running
 * with `NODE_ENV=production` cannot configure. Same call the desktop makes for
 * its local databases (`apps/desktop/src/server/index.ts`) and the SMTP guard
 * makes for a 127.0.0.1 relay (`email/config.ts`) — "production" is a packaging
 * flag, not a trust boundary.
 *
 * Every other provider keeps the production rule. `openai-compatible` is the one
 * that takes an arbitrary, possibly attacker-suggested URL — the actual vector.
 */
function outboundGuardOpts(provider: ProviderId | null): DsnGuardOptions {
  if (provider === 'ollama') return { blockLoopback: false };
  return { blockLoopback: process.env.NODE_ENV === 'production' };
}

/** How many trailing characters of the key the safe reply exposes. */
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
  const [provider, model, baseUrl, storedKey, maxOutputTokens, assistantName, assistantRowData] =
    await Promise.all([
      settings.get('llm.provider'),
      settings.get('llm.model'),
      settings.get('llm.baseUrl'),
      settings.get('llm.apiKey'),
      settings.get('llm.maxOutputTokens'),
      settings.get('assistant.name'),
      settings.get('assistant.rowData'),
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
    assistantName,
    assistantRowData,
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
 * clears it; an absent `apiKey` leaves the stored key untouched (there is no
 * read-back, so the UI omits the field to keep the existing key).
 */
export async function writeLlmConfig(
  settings: SettingsRepo,
  keyCrypto: LlmKeyCrypto,
  body: LlmConfigPutBody,
  ctx: WriteLlmConfigContext,
): Promise<void> {
  const opts = { updatedBy: ctx.updatedBy, at: ctx.at };
  // SSRF: reject a metadata/loopback baseUrl BEFORE the first write, so a
  // refused save leaves the stored config untouched. Guarding inside the
  // `baseUrl` branch below threw after `llm.provider`/`llm.model` had already
  // been persisted, leaving the instance pointing a newly-saved provider at the
  // PREVIOUS provider's baseUrl. The policy pairs the URL with the provider
  // being saved in this same request (see {@link outboundGuardOpts}).
  if (body.baseUrl !== undefined && body.baseUrl !== null && body.baseUrl.length > 0) {
    guardOutboundUrl(body.baseUrl, outboundGuardOpts(body.provider));
  }
  await settings.set('llm.provider', body.provider, opts);
  if (body.model !== undefined) await settings.set('llm.model', body.model, opts);
  if (body.baseUrl !== undefined) {
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
  // Absent means KEEP for both. The provider form is mounted in two places and
  // sends neither; a write that defaulted them would rename the assistant every
  // time somebody saved a model.
  if (body.assistantName !== undefined) await settings.set('assistant.name', body.assistantName, opts);
  if (body.assistantRowData !== undefined) {
    await settings.set('assistant.rowData', body.assistantRowData, opts);
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
    // before this guard, a config-bundle import, or a direct settings write)
    // cannot be dialed. Checked against the STORED provider, which is what
    // closes the two-PUT gap: saving Ollama with a loopback baseUrl and then
    // flipping `llm.provider` to `openai-compatible` (a body with no `baseUrl`
    // field never reaches the write-time guard) is refused here instead.
    guardOutboundUrl(baseUrl, outboundGuardOpts(provider));
    config.baseUrl = baseUrl;
  }

  return { client: createClient(config), provider, model: model ?? '', baseUrl };
}
