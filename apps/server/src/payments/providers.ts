// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The factory seam: one payment provider, built for one operation.
 *
 * ─── WHAT A CALLER GETS ────────────────────────────────────────────────────
 *
 * `paymentProviderFor(deps, key, mode)` checks, at the moment it is asked,
 * that the add-on is installed and switched on, that its server half loaded
 * (a payment provider loads only from a vouched package — `runtime.ts`), and
 * that a credential exists for this mode. Then it calls the add-on's
 * `createPaymentProvider` with an egress-bound HTTP client (its
 * `network.allow` only, redirects refused) and the credential decrypted now,
 * and hands back the provider GUARDED: every answer is parsed with the
 * contract's schema before anyone believes it, a throw becomes a retryable
 * refusal, and an answer outside the contract is treated as the service being
 * unavailable. Nothing here logs a credential or a provider body.
 *
 * Built per operation, never cached: a replaced key is used on the very next
 * call, and a switched-off add-on stops at the very next call, without the
 * runtime being rebuilt.
 *
 * ─── THE DEMO ──────────────────────────────────────────────────────────────
 *
 * The built-in demo provider (key `demo`) is the same transport an add-on
 * would ship, speaking to the in-process demo backend. Test mode only.
 */
import {
  DEMO_PAYMENT_KEY,
  PAYMENT_ANSWER_SCHEMAS,
  PAYMENT_PROVIDER_CONTRACT,
  PAYMENT_PROVIDER_FACTORY,
  PAYMENT_PROVIDER_VERSION,
  createDemoPaymentProvider,
  decimalAmountSchema,
  isProviderError,
  minorAmountAnswerSchema,
  providerError,
  providerErrorSchema,
  type CreatePaymentProvider,
  type DemoPaymentBackend,
  type PaymentCall,
  type PaymentHttpClient,
  type PaymentMode,
  type PaymentProvider,
  type ProviderError,
} from '@adminium/add-on-contracts';
import { addOnManifestSchema, type AddOnManifest } from '@adminium/manifest';
import type { CredentialEnvelope, InstalledManifest } from '@adminium/meta';

import { hostnameAllowed } from '../add-ons/egress-policy.js';
import { providerByKey, type AddOnRuntimeState } from '../add-ons/runtime.js';
import { modeCredentials } from './credentials.js';

/** The fixed demo credentials. The demo is pretend money in test mode; nothing here is secret. */
export const DEMO_CREDENTIALS = { secretKey: 'demo_test_builtin0', webhookSecret: 'demo_whsec_builtin0' } as const;

export interface PaymentSeamDeps {
  /** The loaded add-on runtime, or null before it is built. */
  runtime: () => AddOnRuntimeState | null;
  /** The installed add-on's row and its decrypted credential. */
  manifests: {
    findByKey(key: string): Promise<InstalledManifest | null>;
    getCredential(manifestId: string): Promise<CredentialEnvelope | null>;
  };
  /** The egress-bound client for an add-on (`addOnHttpClientFor`). */
  httpFor: (manifest: AddOnManifest) => PaymentHttpClient;
  /** The in-process demo backend, when this install offers the demo provider. */
  demo: DemoPaymentBackend | null;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

export type ProviderLookupRefusal =
  | 'NOT_INSTALLED'
  | 'SWITCHED_OFF'
  | 'NOT_LOADED'
  | 'NO_FACTORY'
  | 'NO_CREDENTIAL'
  | 'DEMO_IS_TEST_ONLY';

export type ProviderLookup =
  | {
      ok: true;
      key: string;
      mode: PaymentMode;
      provider: PaymentProvider;
      /** The hosts a checkout URL from this provider may send a customer to. */
      redirectHosts: readonly string[];
    }
  | { ok: false; code: ProviderLookupRefusal; message: string };

function refuse(code: ProviderLookupRefusal, message: string): ProviderLookup {
  return { ok: false, code, message };
}

/** The factory inside a loaded module: top level first, then `default`. */
export function factoryOf(module: unknown): CreatePaymentProvider | null {
  const direct = (module as Record<string, unknown> | null)?.[PAYMENT_PROVIDER_FACTORY];
  if (typeof direct === 'function') return direct as CreatePaymentProvider;
  const viaDefault = ((module as { default?: Record<string, unknown> } | null)?.default ?? null)?.[PAYMENT_PROVIDER_FACTORY];
  return typeof viaDefault === 'function' ? (viaDefault as CreatePaymentProvider) : null;
}

/**
 * A provider whose every answer is checked against the contract.
 *
 * A throw is a provider that could not answer: `UNAVAILABLE`, retryable. An
 * answer that fails its schema is a provider that answered outside the
 * contract: `UNAVAILABLE`, not retryable, and logged by call name only.
 */
export function guardProvider(inner: PaymentProvider, log?: PaymentSeamDeps['log']): PaymentProvider {
  const outside = (call: string): ProviderError => {
    log?.('payment provider answered outside its contract', { key: inner.key, call });
    return providerError('UNAVAILABLE', 'The payment service answered in a way Adminium does not understand.');
  };

  async function checked<T>(call: PaymentCall, run: () => Promise<T | ProviderError>): Promise<T | ProviderError> {
    let answer: unknown;
    try {
      answer = await run();
    } catch {
      log?.('payment provider call threw', { key: inner.key, call });
      return providerError('UNAVAILABLE', 'The payment service could not be reached.', true);
    }
    if (isProviderError(answer)) {
      const parsed = providerErrorSchema.safeParse(answer);
      return parsed.success ? (parsed.data as ProviderError) : outside(call);
    }
    const parsed = PAYMENT_ANSWER_SCHEMAS[call].safeParse(answer);
    return parsed.success ? (parsed.data as T) : outside(call);
  }

  function checkedSync<T>(call: string, schema: { safeParse(value: unknown): { success: boolean; data?: unknown } }, run: () => T | ProviderError): T | ProviderError {
    let answer: unknown;
    try {
      answer = run();
    } catch {
      log?.('payment provider call threw', { key: inner.key, call });
      return providerError('UNAVAILABLE', 'The payment service could not convert the amount.');
    }
    if (isProviderError(answer)) {
      const parsed = providerErrorSchema.safeParse(answer);
      return parsed.success ? (parsed.data as ProviderError) : outside(call);
    }
    const parsed = schema.safeParse(answer);
    return parsed.success ? (parsed.data as T) : outside(call);
  }

  return {
    key: inner.key,
    mode: inner.mode,
    checkCredentials: () => checked('checkCredentials', () => inner.checkCredentials()),
    createCheckout: (input) => checked('createCheckout', () => inner.createCheckout(input)),
    status: (ref) => checked('status', () => inner.status(ref)),
    complete: (ref, key) => checked('complete', () => inner.complete(ref, key)),
    expire: (ref) => checked('expire', () => inner.expire(ref)),
    refund: (input) => checked('refund', () => inner.refund(input)),
    refundStatus: (ref) => checked('refundStatus', () => inner.refundStatus(ref)),
    verifyWebhook: (delivery) => checked('verifyWebhook', () => inner.verifyWebhook(delivery)),
    listMissedEvents: (cursor) => checked('listMissedEvents', () => inner.listMissedEvents(cursor)),
    methodsFor: (query) => checked('methodsFor', () => inner.methodsFor(query)),
    toMinor: (amount, currency) => checkedSync('toMinor', minorAmountAnswerSchema, () => inner.toMinor(amount, currency)),
    fromMinor: (minor, currency) => checkedSync('fromMinor', decimalAmountSchema, () => inner.fromMinor(minor, currency)),
  };
}

/**
 * The provider an add-on key names, built for one operation in one mode.
 * Chosen by key, never by the lowest-key rule: a shop that connected PayPal
 * must never be sent to Stripe because it sorts first.
 */
export async function paymentProviderFor(deps: PaymentSeamDeps, key: string, mode: PaymentMode): Promise<ProviderLookup> {
  if (key === DEMO_PAYMENT_KEY) {
    if (deps.demo === null) return refuse('NOT_INSTALLED', 'This install does not offer the demo payment service.');
    if (mode !== 'test') return refuse('DEMO_IS_TEST_ONLY', 'The demo payment service works in test mode only.');
    const demo = deps.demo;
    return {
      ok: true,
      key,
      mode,
      provider: guardProvider(createDemoPaymentProvider({ http: demo.http, credentials: DEMO_CREDENTIALS, mode }), deps.log),
      // The demo's hosted page is an engine route: the caller checks it is on the pay address.
      redirectHosts: [],
    };
  }

  const installed = await deps.manifests.findByKey(key);
  if (installed === null) return refuse('NOT_INSTALLED', `The payment add-on "${key}" is not installed.`);
  if (installed.row.status !== 'installed') return refuse('SWITCHED_OFF', `The payment add-on "${key}" is switched off.`);
  const manifest = addOnManifestSchema.safeParse(installed.document);
  if (!manifest.success) return refuse('NOT_LOADED', `The payment add-on "${key}" has a manifest this build cannot read.`);

  const state = deps.runtime();
  const entry = state === null ? null : providerByKey(state, PAYMENT_PROVIDER_CONTRACT, PAYMENT_PROVIDER_VERSION, key);
  if (entry === null) return refuse('NOT_LOADED', `The payment add-on "${key}" did not load. Its package may not be one Adminium can vouch for.`);
  const factory = factoryOf(entry.module);
  if (factory === null) return refuse('NO_FACTORY', `The payment add-on "${key}" exports no ${PAYMENT_PROVIDER_FACTORY}.`);

  const credentials = modeCredentials(await deps.manifests.getCredential(installed.row.id), mode);
  if (credentials === null) return refuse('NO_CREDENTIAL', `The payment add-on "${key}" has no ${mode} key saved.`);

  let provider: PaymentProvider;
  try {
    provider = factory({ http: deps.httpFor(manifest.data), credentials, mode });
  } catch {
    deps.log?.('payment provider factory threw', { key });
    return refuse('NO_FACTORY', `The payment add-on "${key}" could not be started.`);
  }
  return {
    ok: true,
    key,
    mode,
    provider: guardProvider(provider, deps.log),
    redirectHosts: manifest.data.addOn.network?.allow ?? [],
  };
}

/**
 * Whether a checkout URL may receive a customer: https, no credentials in it,
 * and a host in the provider's `network.allow` (or one the account set as its
 * own checkout domain). Anything else is refused before the browser is sent.
 */
export function checkoutUrlAllowed(url: string, hosts: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return hosts.length > 0 && hostnameAllowed(parsed, hosts) === 'ok';
}
