// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CARRIER KEY'S OWN DOOR: asking the carrier about a key, and whether the
 * saved key is still the one it answered for.
 *
 * Test or live is the carrier's answer, never read from the key's prefix. The
 * key itself is handed to the carrier and to the encrypted credential store,
 * and to nothing else: no reply, log line, audit row or plain column.
 */
import { CARRIER_REFUSALS, carrierCredentialCheckSchema, classifyBookFailure, type CredentialCheckQuery } from '@adminium/add-on-contracts';
import type { AddOnManifest } from '@adminium/manifest';
import { shippingRepo, type MetaDb, type ShippingAccount, type ShippingKeyMode } from '@adminium/meta';

import { cleanCarrierMessage, type ResolvedCarrier, type ShippingCarrierDeps } from './carriers.js';
import { sameHash } from './fingerprint.js';
import { ShippingRefusal } from './refusals.js';

export type KeyCheck =
  | { outcome: 'ok'; mode: ShippingKeyMode; carriers: string[]; accountId?: string }
  | { outcome: 'refused'; carrierMessage?: string }
  | { outcome: 'unreachable' };

/** A booking that still depends on a key: enough to ask whether this person reaches its order. */
export interface OpenBooking {
  connectionId: string;
  installId: string;
  tableRef: string;
  tableName: string;
  rowKey: string;
}

/**
 * The bookings holding a carrier's key. `count` is every one of them, whichever
 * app made it, because that is why the key is locked. `own` is this app
 * install's alone: the only ones that could be named to its manager.
 */
export interface OpenBookings {
  count: number;
  own: readonly OpenBooking[];
}

/** How a key's lock reads to one person: the true count, and the orders they may be told of. */
export interface KeyLock {
  count: number;
  orders: string[];
}

/** The names of the fields a carrier's key is made of. */
export function keyFieldsOf(manifest: AddOnManifest): string[] {
  return (manifest.settings ?? []).filter((setting) => setting.secret === true).map((setting) => setting.key);
}

/** Asks the carrier about the key it was built with. Buys nothing and stores nothing. */
export async function checkCarrierKey(resolved: ResolvedCarrier, query: CredentialCheckQuery, log?: ShippingCarrierDeps['log']): Promise<KeyCheck> {
  const check = resolved.carrier.checkCredentials;
  if (typeof check !== 'function') throw new ShippingRefusal('CARRIER_NO_CHECK', `The carrier "${resolved.key}" cannot check a key, so none is saved.`, { carrier: resolved.key });
  let answer: unknown;
  try {
    answer = await check.call(resolved.carrier, query);
  } catch (error) {
    const failure = classifyBookFailure(error);
    const reason = (error as { reason?: unknown } | null)?.reason;
    if (failure.outcome === 'refused' && reason === ('credentials' satisfies (typeof CARRIER_REFUSALS)[number])) {
      return { outcome: 'refused', ...(failure.carrierMessage === undefined ? {} : { carrierMessage: cleanCarrierMessage(failure.carrierMessage, resolved.scrub) }) };
    }
    log?.('a carrier could not answer', { key: resolved.key, call: 'check' });
    return { outcome: 'unreachable' };
  }
  const parsed = carrierCredentialCheckSchema.safeParse(answer);
  if (!parsed.success) {
    log?.('a carrier answered outside its contract', { key: resolved.key, call: 'check' });
    throw new ShippingRefusal('CARRIER_BAD_ANSWER', 'The carrier answered in a way Adminium does not understand.', { carrier: resolved.key });
  }
  if (parsed.data.outcome === 'unreachable') return { outcome: 'unreachable' };
  if (parsed.data.outcome === 'refused') {
    const said = parsed.data.carrierMessage;
    return { outcome: 'refused', ...(said === undefined ? {} : { carrierMessage: cleanCarrierMessage(said, resolved.scrub) }) };
  }
  const carriers = [...new Set(parsed.data.carriers.map((name) => cleanCarrierMessage(name, resolved.scrub).slice(0, 80)).filter((name) => name.length > 0))].slice(0, 100);
  return { outcome: 'ok', mode: parsed.data.mode, carriers, ...(parsed.data.accountFingerprint === undefined ? {} : { accountId: parsed.data.accountFingerprint }) };
}

/**
 * The account record of the key this carrier was built with, or a refusal.
 * A key with no record, a changed key, or one the carrier last refused is
 * not used: nobody knows whether it is test or live.
 */
export async function checkedAccount(meta: MetaDb, secret: string, resolved: ResolvedCarrier): Promise<ShippingAccount> {
  const account = await shippingRepo(meta).account(resolved.install.row.id);
  if (account === null || !sameHash(account.keyHash, resolved.keyHash(secret))) {
    throw new ShippingRefusal('CARRIER_NOT_CHECKED', `The key saved for "${resolved.key}" has not been checked.`, { carrier: resolved.key, reason: 'unchecked' });
  }
  if (account.state !== 'ok') {
    throw new ShippingRefusal('CARRIER_NOT_CHECKED', `The carrier did not accept the key saved for "${resolved.key}".`, { carrier: resolved.key, reason: 'refused' });
  }
  return account;
}
