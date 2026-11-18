// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE CALL TO ONE SOURCE of a lead source add-on, and everything that holds
 * around it.
 *
 * A lead source add-on provides `lead-source@1` once, and speaks for several
 * services (`addOn.sources`). `withLeadSource` builds that add-on's source for
 * one call to one of them, and only after asking, in this order:
 *  - the install is there and switched on, and the source is one it declares
 *    (the website reader is the engine's own, never called through here);
 *  - the owner's switch for the source is on;
 *  - its key is saved, when it needs one;
 *  - the add-on's server half loaded (only from a package Adminium vouches
 *    for);
 *  - the source is not paused, not already answering two calls, and its rate
 *    window has room (`caps.ts`);
 *  - the day's cap, and the caller's own share of it, have room (reserved
 *    now, settled after).
 * Then the source is made with a client that reaches only that source's
 * hosts (every refusal audited as any add-on's is), that source's key and no
 * other, and a stop signal that is the caller's Stop and the engine's own
 * deadline at once. A 429 from its service, or its own "rate limited", pauses
 * that source alone. A throw is the source being unavailable.
 *
 * It does not parse the answer nor audit what the call was for: the caller
 * does both, with the contract's answer schemas, as it knows which call it
 * made.
 */
import {
  LEAD_SOURCE_CONTRACT,
  LEAD_SOURCE_FACTORY,
  LEAD_SOURCE_VERSION,
  SOURCE_READS_WEBSITE,
  isLeadSourceError,
  type CreateLeadSource,
  type LeadSource,
  type LeadSourceContext,
  type LeadSourceError,
  type LeadSourceHttpClient,
} from '@adminium/add-on-contracts';
import { addOnManifestSchema, type AddOnManifest } from '@adminium/manifest';
import type { CredentialEnvelope, InstalledManifest, MetaDb } from '@adminium/meta';

import { addOnHttpClientFor, type AddOnHttpClientOptions } from '../add-ons/egress.js';
import { providerByKey, type AddOnRuntimeState } from '../add-ons/runtime.js';
import { reserveDay, retryAfterSeconds, sourceGate, type SourceGate, type SourceRefusal } from './caps.js';
import { sourceKey, withoutKey } from './keys.js';
import { needsKey, readSourcesState, sourceStateOf, sourcesOf, type LeadSourceEntry } from './state.js';

/** How long the engine waits for one call, whatever the source does with its stop signal. */
export const CALL_DEADLINE_MS = 60_000;
/** After the deadline, how long a source that ignores its signal is waited for before the engine gives up on it. */
const DEADLINE_GRACE_MS = 2_000;

/** Either the engine's refusal before the source was asked, or the source's own. */
export type LeadSourceRefusal = SourceRefusal | LeadSourceError;

export interface LeadSourceDeps {
  meta: MetaDb;
  /** The install's decrypted credential envelope. */
  manifests: { getCredential(manifestId: string): Promise<CredentialEnvelope | null> };
  /** The loaded add-on runtime, or null before it is built. */
  runtime: () => AddOnRuntimeState | null;
  /** Trial mode and the hosted profile, as every add-on client gets them. */
  policy?: AddOnHttpClientOptions['policy'];
  /** Test seams. */
  fetchImpl?: typeof globalThis.fetch | undefined;
  lookup?: AddOnHttpClientOptions['lookup'];
  gate?: SourceGate | undefined;
  now?: () => number;
  deadlineMs?: number | undefined;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

export interface LeadSourceCall {
  install: InstalledManifest;
  /** The `addOn.sources[].id` to ask. */
  source: string;
  /** Who spends the call: a staff member's id, or `step` for the automation step. */
  spender: string;
  signal: AbortSignal;
  /** The reader's language, for labels a source gives in several. Default `en-US`. */
  locale?: string | undefined;
  /**
   * `check`: the key's Check on the Sources screen. It works with the
   * switch off (a key is checked before the source is switched on) and spends
   * nothing of the day; the rest holds.
   */
  purpose?: 'call' | 'check' | undefined;
}

const invalid = (message: string): LeadSourceError => ({ ok: false, code: 'INVALID_REQUEST', message });
const unavailable = (message: string): LeadSourceError => ({ ok: false, code: 'UNAVAILABLE', message });
const refuse = (code: SourceRefusal['code'], message: string): SourceRefusal => ({ ok: false, code, message });

function factoryOf(module: unknown): CreateLeadSource | null {
  const candidate = (module as Record<string, unknown> | null)?.[LEAD_SOURCE_FACTORY];
  return typeof candidate === 'function' ? (candidate as CreateLeadSource) : null;
}

/** An install's add-on manifest, or null when it does not read as one. */
export function installManifest(install: InstalledManifest): AddOnManifest | null {
  const parsed = addOnManifestSchema.safeParse(install.document);
  return parsed.success ? parsed.data : null;
}

/** The manifest entry of one source of an install, with the manifest; or why there is none. */
export function sourceEntryOf(install: InstalledManifest, source: string): { manifest: AddOnManifest; entry: LeadSourceEntry } | LeadSourceError {
  const manifest = installManifest(install);
  if (manifest === null) return unavailable(`The add-on "${install.row.manifestKey}" has a manifest this server cannot read.`);
  const entry = sourcesOf(manifest).find((one) => one.id === source);
  if (entry === undefined) return invalid(`The add-on "${install.row.manifestKey}" has no source "${source}".`);
  return { manifest, entry };
}

export async function withLeadSource<T>(deps: LeadSourceDeps, call: LeadSourceCall, run: (source: LeadSource) => Promise<T | LeadSourceError>): Promise<T | LeadSourceRefusal> {
  const now = deps.now ?? Date.now;
  const gate = deps.gate ?? sourceGate;
  const { install, source } = call;
  const check = call.purpose === 'check';

  const found = sourceEntryOf(install, source);
  if (!('entry' in found)) return found;
  const { manifest, entry } = found;
  // The website is read by the engine's own reader, never by add-on code.
  if (entry.reads === SOURCE_READS_WEBSITE) return invalid(`"${source}" is the website, which Adminium reads itself.`);
  if (install.row.status !== 'installed') return refuse('SOURCE_OFF', `The add-on "${manifest.key}" is switched off.`);

  const state = sourceStateOf(await readSourcesState(deps.meta, install.row.id), entry);
  if (!check && !state.on) return refuse('SOURCE_OFF', `${source} is switched off.`);
  let key: string | null = null;
  if (needsKey(entry)) {
    key = sourceKey(await deps.manifests.getCredential(install.row.id), source);
    if (key === null) return refuse('KEY_NOT_SET', `${source}: key not set.`);
  }

  const runtime = deps.runtime();
  const provider = runtime === null ? null : providerByKey(runtime, LEAD_SOURCE_CONTRACT, LEAD_SOURCE_VERSION, manifest.key);
  const factory = provider === null ? null : factoryOf(provider.module);
  if (factory === null) return refuse('NOT_VOUCHED', `The add-on "${manifest.key}" did not load: only a package Adminium vouches for may speak for a source.`);

  const entered = gate.enter(install.row.id, source, entry.window);
  if (!entered.ok) return entered;
  let hold: { settle(made: boolean): Promise<void> } | null = null;
  let made = false;
  try {
    if (!check) {
      const reserved = await reserveDay(deps.meta, { installId: install.row.id, source, spender: call.spender, state, at: now() });
      if (!reserved.ok) return reserved;
      hold = reserved.hold;
    }

    const deadlineMs = deps.deadlineMs ?? CALL_DEADLINE_MS;
    const signal = AbortSignal.any([call.signal, AbortSignal.timeout(deadlineMs)]);
    const client = addOnHttpClientFor(deps.meta, manifest, { policy: deps.policy, fetchImpl: deps.fetchImpl, lookup: deps.lookup, signal, narrowTo: entry.hosts ?? [] });
    // A 429 pauses this source alone, for as long as its service says.
    const http: LeadSourceHttpClient = async (input, init) => {
      const response = await client(input, init);
      if (response.status === 429) gate.pause(install.row.id, source, retryAfterSeconds(response.headers.get('retry-after'), now()));
      return response;
    };
    const context: LeadSourceContext = { source, key, http, signal, locale: call.locale ?? 'en-US' };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<LeadSourceError>((resolve) => {
      timer = setTimeout(() => resolve(unavailable(`${source} did not answer in time.`)), deadlineMs + DEADLINE_GRACE_MS);
    });
    try {
      made = true;
      const answer = await Promise.race([run(factory(context)), late]);
      if (!isLeadSourceError(answer)) return answer;
      if (answer.code === 'RATE_LIMITED') gate.pause(install.row.id, source, answer.retryAfterSeconds);
      // A refusal's words go to a screen and a log: never with the key, nor a URL's query string, in them.
      return { ...answer, message: withoutKey(answer.message, key) };
    } catch (error) {
      deps.log?.('a lead source call threw', { addOn: manifest.key, source, error: error instanceof Error ? error.name : typeof error });
      return unavailable(`${source} could not be reached.`);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    entered.leave();
    await hold?.settle(made);
  }
}
