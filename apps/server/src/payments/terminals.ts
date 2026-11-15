// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The card-reader seam (`card-terminal@1`): the service a key names, built
 * for one operation in one mode, every answer parsed against the contract's
 * own schemas. An answer outside them, or a call that throws, is the service
 * being unavailable — never a decision about money.
 *
 * The demo reader (`demo-reader`) is in process, test mode only. Any other
 * key is an installed add-on providing the contract (`createCardTerminal`),
 * with the same credentials its payment half uses.
 */
import {
  CARD_TERMINAL_ANSWER_SCHEMAS,
  CARD_TERMINAL_CONTRACT,
  CARD_TERMINAL_FACTORY,
  CARD_TERMINAL_VERSION,
  DEMO_TERMINAL_KEY,
  isProviderError,
  providerError,
  providerErrorSchema,
  type CardTerminal,
  type CardTerminalCall,
  type CreateCardTerminal,
  type DemoTerminalBackend,
  type PaymentMode,
  type ProviderError,
} from '@adminium/add-on-contracts';
import { addOnManifestSchema } from '@adminium/manifest';

import { providerByKey } from '../add-ons/runtime.js';
import { serverWideOrOnly } from '../installs/resolve.js';
import { modeCredentials } from './credentials.js';
import type { PaymentSeamDeps } from './providers.js';

export interface TerminalSeamDeps extends Omit<PaymentSeamDeps, 'demo'> {
  /** The in-process demo reader, when this install offers it. */
  demoTerminal: DemoTerminalBackend | null;
}

export type TerminalLookup = { ok: true; key: string; mode: PaymentMode; terminal: CardTerminal } | { ok: false; code: string; message: string };

const refuse = (code: string, message: string): TerminalLookup => ({ ok: false, code, message });

/** Every answer parsed against the contract: one outside it is the service being unavailable. */
export function guardTerminal(inner: CardTerminal, log?: PaymentSeamDeps['log']): CardTerminal {
  const outside = (call: string): ProviderError => {
    log?.('card reader service answered outside its contract', { key: inner.key, call });
    return providerError('UNAVAILABLE', 'The card reader service answered in a way Adminium does not understand.', true);
  };
  async function checked<T>(call: CardTerminalCall, run: () => Promise<T | ProviderError>): Promise<T | ProviderError> {
    let answer: unknown;
    try {
      answer = await run();
    } catch {
      log?.('card reader service call threw', { key: inner.key, call });
      return providerError('UNAVAILABLE', 'The card reader service could not be reached.', true);
    }
    if (isProviderError(answer)) {
      const parsed = providerErrorSchema.safeParse(answer);
      return parsed.success ? (parsed.data as ProviderError) : outside(call);
    }
    const parsed = CARD_TERMINAL_ANSWER_SCHEMAS[call].safeParse(answer);
    return parsed.success ? (parsed.data as T) : outside(call);
  }
  return {
    key: inner.key,
    mode: inner.mode,
    checkCredentials: () => checked('checkCredentials', () => inner.checkCredentials()),
    listLocations: () => checked('listLocations', () => inner.listLocations()),
    listReaders: (locationId) => checked('listReaders', () => inner.listReaders(locationId)),
    startPairing: (input) => checked('startPairing', () => inner.startPairing(input)),
    finishPairing: (input) => checked('finishPairing', () => inner.finishPairing(input)),
    unpairReader: (readerId) => checked('unpairReader', () => inner.unpairReader(readerId)),
    sendToReader: (input) => checked('sendToReader', () => inner.sendToReader(input)),
    readerStatus: (ref) => checked('readerStatus', () => inner.readerStatus(ref)),
    cancelOnReader: (ref) => checked('cancelOnReader', () => inner.cancelOnReader(ref)),
    refund: (input) => checked('refund', () => inner.refund(input)),
    refundStatus: (ref) => checked('refundStatus', () => inner.refundStatus(ref)),
    listEvents: (cursor) => checked('listEvents', () => inner.listEvents(cursor)),
    toMinor: (amount, currency) => {
      try {
        return inner.toMinor(amount, currency);
      } catch {
        return providerError('UNAVAILABLE', 'The card reader service could not convert the amount.');
      }
    },
    fromMinor: (minor, currency) => {
      try {
        return inner.fromMinor(minor, currency);
      } catch {
        return providerError('UNAVAILABLE', 'The card reader service could not convert the amount.');
      }
    },
  };
}

function factoryOf(module: unknown): CreateCardTerminal | null {
  const candidate = (module as Record<string, unknown> | null)?.[CARD_TERMINAL_FACTORY];
  return typeof candidate === 'function' ? (candidate as CreateCardTerminal) : null;
}

/** The card reader service a key names, in one mode. */
export async function cardTerminalFor(deps: TerminalSeamDeps, key: string, mode: PaymentMode): Promise<TerminalLookup> {
  if (key === DEMO_TERMINAL_KEY) {
    if (deps.demoTerminal === null) return refuse('NOT_INSTALLED', 'This install does not offer the demo card reader.');
    if (mode !== 'test') return refuse('DEMO_IS_TEST_ONLY', 'The demo card reader works in test mode only.');
    return { ok: true, key, mode, terminal: guardTerminal(deps.demoTerminal.terminal(mode), deps.log) };
  }
  // Kept once per server, as its payment half is: never the first of several installs of the key.
  const kept = await serverWideOrOnly(deps.manifests, key);
  const found = kept !== null && kept.row.kind === 'add-on' ? kept : null;
  if (found === null) return refuse('NOT_INSTALLED', `The card reader add-on "${key}" is not installed.`);
  if (found.row.status !== 'installed') return refuse('SWITCHED_OFF', `The card reader add-on "${key}" is switched off.`);
  const manifest = addOnManifestSchema.safeParse(found.document);
  if (!manifest.success) return refuse('NOT_LOADED', `The card reader add-on "${key}" has a manifest this build cannot read.`);
  const state = deps.runtime();
  const entry = state === null ? null : providerByKey(state, CARD_TERMINAL_CONTRACT, CARD_TERMINAL_VERSION, key);
  if (entry === null) return refuse('NOT_LOADED', `The card reader add-on "${key}" did not load.`);
  const factory = factoryOf(entry.module);
  if (factory === null) return refuse('NO_FACTORY', `The card reader add-on "${key}" exports no ${CARD_TERMINAL_FACTORY}.`);
  const credentials = modeCredentials(await deps.manifests.getCredential(found.row.id), mode);
  if (credentials === null) return refuse('NO_CREDENTIAL', `The card reader add-on "${key}" has no ${mode} key saved.`);
  try {
    return { ok: true, key, mode, terminal: guardTerminal(factory({ http: deps.httpFor(manifest.data), credentials, mode }), deps.log) };
  } catch {
    return refuse('NO_FACTORY', `The card reader add-on "${key}" could not be started.`);
  }
}
