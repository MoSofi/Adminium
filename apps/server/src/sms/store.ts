// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where the one SMS account of this server is kept.
 *
 * An interface, so the service can be tested without a database. Whatever
 * implements this (`account-store.ts`) holds the keys only as the sealed
 * `enc:v1:` value and never opens it.
 *
 * Writes are compare-and-set on `revision`: checking a key with the provider is
 * slow and happens outside any lock, so two saves at once must not let the
 * slower one quietly overwrite the other, on one server process or several.
 */
import type { SmsCheckReason, SmsProviderKey, SmsSender } from './types.js';

export interface SmsCheckRecord {
  ok: boolean;
  /** Why not, when it did not pass. */
  reason: SmsCheckReason | null;
  at: number;
}

/** Everything kept about the account. Only `sealedCredentials` is secret, and it is sealed. */
export interface SmsAccountFields {
  provider: SmsProviderKey;
  /** An `enc:v1:` token. */
  sealedCredentials: string;
  /** Masked, as the provider's check reported it. */
  accountName: string | null;
  /** `…1a2b`. */
  accountHint: string;
  accountType: 'full' | 'trial' | null;
  sender: SmsSender | null;
  /** ISO country a local number is read in; null means only `+` numbers read. */
  defaultCountry: string | null;
  check: SmsCheckRecord;
  savedAt: number;
  savedBy: string | null;
}

export interface SmsAccountRow extends SmsAccountFields {
  /** Goes up by one on every write. */
  revision: number;
}

export interface SmsAccountStore {
  read(): Promise<SmsAccountRow | null>;
  /**
   * Write the account if the stored revision is still `expected` (null: there
   * is no account yet). Returns the new row, or null when someone else wrote
   * first and nothing was changed.
   */
  write(fields: SmsAccountFields, expected: number | null): Promise<SmsAccountRow | null>;
  /** Remove the account if the stored revision is still `expected`. False when it was not. */
  remove(expected: number): Promise<boolean>;
}
