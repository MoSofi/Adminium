// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The factory seam for delivery companies: one carrier, built for one
 * operation, from the install on the ORDER'S DATABASE.
 *
 * ─── WHICH INSTALL ─────────────────────────────────────────────────────────
 *
 * Two businesses on one server have two carrier accounts, so a carrier is
 * resolved per database: its install on the order's connection, else one kept
 * for the whole server. Never `serverWideOrOnly` and never the lowest key:
 * either would post one shop's parcels on another shop's account.
 *
 * ─── THE ORDER OF THE CHECKS ───────────────────────────────────────────────
 *
 * Lock, installed, switched on, manifest, loaded through the vouched runtime,
 * factory, and only then the credential, so a locked carrier's key is never
 * decrypted. Built per operation and never cached: a replaced key is used on
 * the next call, and a carrier switched off stops at the next call.
 *
 * ─── WHAT A CARRIER'S ANSWER IS WORTH ──────────────────────────────────────
 *
 * Parsed with the contract's schema before anyone believes it. A thrown error
 * is read by its shape, because each add-on bundle inlines its own copy of
 * `CarrierError`. Nothing here is marked safe to retry: a purchase decides that
 * for itself. No credential or carrier body reaches a log line.
 */
import {
  CARRIER_REFUSALS,
  SHIPPING_CARRIER_CONTRACT,
  SHIPPING_CARRIER_FACTORY,
  SHIPPING_CARRIER_VERSION,
  classifyBookFailure,
  rateSchema,
  type Address,
  type CarrierRefusal,
  type Parcel,
  type QuoteOptions,
  type Rate,
  type ShippingCarrier,
  type ShippingCarrierContext,
  type ShippingHttpClient,
} from '@adminium/add-on-contracts';
import { addOnManifestSchema, type AddOnManifest } from '@adminium/manifest';
import { type InstalledManifest, type ManifestsRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { addOnHttpClientFor, type AddOnHttpClientOptions } from '../add-ons/egress.js';
import { providerByKey, type AddOnRuntimeState } from '../add-ons/runtime.js';
import { installOnConnection } from '../installs/resolve.js';
import { carrierLocked } from './locks.js';
import { ShippingRefusal, type ShippingRefusalCode } from './refusals.js';

/** How long one request to a carrier may take. */
export const CARRIER_HTTP_TIMEOUT_MS = 15_000;
/** The longest carrier message a screen is given. */
export const CARRIER_MESSAGE_MAX = 300;
const MAX_RATES = 100;
const MAX_RATES_BYTES = 256 * 1024;

export interface ShippingCarrierDeps {
  /** The loaded add-on runtime, or null before it is built. */
  runtime: () => AddOnRuntimeState | null;
  manifests: Pick<ManifestsRepo, 'findInScope' | 'getCredential'>;
  /** The egress-bound client for this add-on (`carrierHttpFor`). */
  httpFor: (manifest: AddOnManifest) => ShippingHttpClient;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

export interface ResolvedCarrier {
  key: string;
  install: InstalledManifest;
  carrier: ShippingCarrier;
  /** Takes this carrier's saved key values out of a text it might echo them in. */
  scrub(text: string): string;
}

type CarrierFactory = (context: ShippingCarrierContext) => ShippingCarrier;

/** The factory inside a loaded module: top level first, then `default`. */
function factoryOf(module: unknown): CarrierFactory | null {
  const direct = (module as Record<string, unknown> | null)?.[SHIPPING_CARRIER_FACTORY];
  if (typeof direct === 'function') return direct as CarrierFactory;
  const viaDefault = ((module as { default?: Record<string, unknown> } | null)?.default ?? null)?.[SHIPPING_CARRIER_FACTORY];
  return typeof viaDefault === 'function' ? (viaDefault as CarrierFactory) : null;
}

const credentialFields = z.record(z.string().min(1), z.string().min(1));

function refuse(code: ShippingRefusalCode, key: string, message: string): ShippingRefusal {
  return new ShippingRefusal(code, message, { carrier: key });
}

/** The client a carrier is handed: its own `network.allow`, no redirects, 15 seconds a request. */
export function carrierHttpFor(meta: MetaDb, manifest: AddOnManifest, policy: AddOnHttpClientOptions['policy']): ShippingHttpClient {
  return (url, init) => {
    const { signal, ...rest } = init ?? {};
    const client = addOnHttpClientFor(meta, manifest, { policy, timeoutMs: CARRIER_HTTP_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) });
    return client(url, rest);
  };
}

/** The carrier `key` names on this database, ready for one operation, or the refusal that says why not. */
export async function shippingCarrierFor(deps: ShippingCarrierDeps, key: string, connectionId: string, todayIso: string): Promise<ResolvedCarrier> {
  if (carrierLocked(key)) throw refuse('CARRIER_LOCKED', key, `"${key}" runs as a demo for now, so no real carrier is called.`);

  const found = await installOnConnection(deps.manifests as ManifestsRepo, key, connectionId);
  const install = found !== null && found.row.kind === 'add-on' ? found : null;
  if (install === null) throw refuse('CARRIER_NOT_INSTALLED', key, `The carrier "${key}" is not installed on this database.`);
  if (install.row.status !== 'installed') throw refuse('CARRIER_SWITCHED_OFF', key, `The carrier "${key}" is switched off.`);
  const manifest = addOnManifestSchema.safeParse(install.document);
  if (!manifest.success) throw refuse('CARRIER_NOT_LOADED', key, `The carrier "${key}" has a manifest this build cannot read.`);

  const state = deps.runtime();
  const entry = state === null ? null : providerByKey(state, SHIPPING_CARRIER_CONTRACT, SHIPPING_CARRIER_VERSION, key);
  if (entry === null) throw refuse('CARRIER_NOT_LOADED', key, `The carrier "${key}" did not load. Its package may not be one Adminium can vouch for.`);
  const factory = factoryOf(entry.module);
  if (factory === null) throw refuse('CARRIER_NO_FACTORY', key, `The carrier "${key}" exports no ${SHIPPING_CARRIER_FACTORY}.`);

  let credentials: Record<string, string>;
  try {
    const parsed = credentialFields.safeParse((await deps.manifests.getCredential(install.row.id))?.secret);
    if (!parsed.success || Object.keys(parsed.data).length === 0) throw refuse('CARRIER_NO_CREDENTIAL', key, `The carrier "${key}" has no key saved.`);
    credentials = parsed.data;
  } catch (error) {
    if (error instanceof ShippingRefusal) throw error;
    // A key that no longer decrypts (the server's secret changed) is a key that has to be saved again.
    deps.log?.('a carrier credential could not be read', { key });
    throw refuse('CARRIER_NO_CREDENTIAL', key, `The carrier "${key}" has no key that can be read.`);
  }

  let carrier: ShippingCarrier;
  try {
    carrier = factory({ http: deps.httpFor(manifest.data), credentials, todayIso });
  } catch {
    deps.log?.('a carrier factory threw', { key });
    throw refuse('CARRIER_NO_FACTORY', key, `The carrier "${key}" could not be started.`);
  }
  if (typeof (carrier as { quote?: unknown } | null)?.quote !== 'function') throw refuse('CARRIER_NO_FACTORY', key, `The carrier "${key}" could not be started.`);

  const secrets = Object.values(credentials).filter((value) => value.length >= 4);
  const scrub = (text: string) => secrets.reduce((out, secret) => out.split(secret).join('[hidden]'), text);
  return { key, install, carrier, scrub };
}

/**
 * What a screen may show of a carrier's words: no control or invisible
 * characters (a bidirectional override can make a message read backwards),
 * none of the saved key, and at most 300 characters.
 */
export function cleanCarrierMessage(text: string, scrub: (text: string) => string = (same) => same): string {
  return scrub(text)
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CARRIER_MESSAGE_MAX);
}

/** A thrown value, as the refusal a person is shown. Read by its shape, never `instanceof`. */
function quoteFailure(error: unknown, resolved: ResolvedCarrier, log: ShippingCarrierDeps['log']): ShippingRefusal {
  const failure = classifyBookFailure(error);
  if (failure.carrierMessage === undefined) {
    log?.('a carrier could not answer', { key: resolved.key, call: 'quote' });
    return new ShippingRefusal('CARRIER_UNAVAILABLE', 'The carrier could not be reached.', { carrier: resolved.key });
  }
  const said = (error as { reason?: unknown }).reason;
  const reason = (CARRIER_REFUSALS as readonly unknown[]).includes(said) ? (said as CarrierRefusal) : null;
  // The code is the carrier's own text too, so the log gets it cleaned.
  const carrierCode = cleanCarrierMessage(failure.code, resolved.scrub).slice(0, 80);
  log?.('a carrier refused a quote', { key: resolved.key, code: carrierCode });
  return new ShippingRefusal('CARRIER_REFUSED', 'The carrier refused this request.', {
    carrier: resolved.key,
    carrierCode,
    reason,
    carrierMessage: cleanCarrierMessage(failure.carrierMessage, resolved.scrub),
  });
}

/** The carrier's rates, every one checked against the contract. */
export async function askForRates(resolved: ResolvedCarrier, parcel: Parcel, from: Address, to: Address, options: QuoteOptions, log?: ShippingCarrierDeps['log']): Promise<Rate[]> {
  let answer: unknown;
  try {
    answer = await resolved.carrier.quote(parcel, from, to, options);
  } catch (error) {
    throw quoteFailure(error, resolved, log);
  }
  const bad = () => {
    log?.('a carrier answered outside its contract', { key: resolved.key, call: 'quote' });
    return new ShippingRefusal('CARRIER_BAD_ANSWER', 'The carrier answered in a way Adminium does not understand.', { carrier: resolved.key });
  };
  const parsed = z.array(rateSchema).max(MAX_RATES).safeParse(answer);
  if (!parsed.success || JSON.stringify(parsed.data).length > MAX_RATES_BYTES) throw bad();
  for (const rate of parsed.data) {
    if (rate.expiresAt !== undefined && Number.isNaN(Date.parse(rate.expiresAt))) throw bad();
    // A float too large to print as a decimal cannot be shown as a price.
    if (rate.amountDecimal === undefined && !/^\d+(\.\d+)?$/.test(String(rate.amount))) throw bad();
  }
  return parsed.data as Rate[];
}
