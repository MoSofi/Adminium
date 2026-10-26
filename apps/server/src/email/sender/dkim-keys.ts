// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sending domains' DKIM keys: made here, kept encrypted, read back only
 * to sign.
 *
 * The private key is encrypted under a key derived for this purpose alone
 * (`adminium:dkim-key:v1`). Every read gives the public key and the DNS
 * record; `signingOptionsFor` is the one place the private key is decrypted,
 * and it is returned only in nodemailer's `privateKey` field, which the log
 * redacts by name. A key that no longer decrypts (the server's
 * `ADMINIUM_SECRET` changed) signs nothing: the screen offers "Make a key"
 * again.
 */
import { emailDkimKeysRepo, type DkimKeyRow, type MetaDb } from '@adminium/meta';

import { decryptSecret, deriveKey, encryptSecret } from '../../config/secrets.js';
import { DEFAULT_DKIM_SELECTOR, dkimDnsRecord, dkimSignOptions, generateDkimKey, type DkimDnsRecord, type DkimSignOptions } from './dkim.js';

export const DKIM_KEY_SALT = 'adminium:dkim-key:v1';

/** A DNS name: labels of letters, digits and hyphens, not starting or ending with a hyphen. */
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SELECTOR = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export class DkimKeyError extends Error {
  override readonly name = 'DkimKeyError';
  constructor(
    readonly code: 'invalid-domain' | 'invalid-selector' | 'exists',
    message: string,
  ) {
    super(message);
  }
}

export interface DkimKeyView {
  id: string;
  domain: string;
  selector: string;
  publicKey: string;
  record: DkimDnsRecord;
  createdAt: number;
}

const viewOf = (row: DkimKeyRow): DkimKeyView => ({
  id: row.id,
  domain: row.domain,
  selector: row.selector,
  publicKey: row.publicKey,
  record: dkimDnsRecord(row.domain, row.selector, row.publicKey),
  createdAt: row.createdAt,
});

export interface DkimKeysDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`. */
  secret: string;
  now?: () => number;
}

export function createDkimKeys(deps: DkimKeysDeps) {
  const key = deriveKey(deps.secret, DKIM_KEY_SALT);
  const now = deps.now ?? Date.now;
  const repo = emailDkimKeysRepo(deps.meta, { encrypt: (plain) => encryptSecret(plain, key), decrypt: (token) => decryptSecret(token, key) });

  return {
    /** "Make a key": a new RSA key for the domain under the selector. */
    async make(rawDomain: string, input: { selector?: string; createdBy?: string | null } = {}): Promise<DkimKeyView> {
      const domain = rawDomain.trim().toLowerCase().replace(/\.$/, '');
      const selector = (input.selector ?? DEFAULT_DKIM_SELECTOR).trim().toLowerCase();
      if (!DOMAIN.test(domain)) throw new DkimKeyError('invalid-domain', 'That is not a domain name.');
      if (!SELECTOR.test(selector)) throw new DkimKeyError('invalid-selector', 'A selector is letters, digits and hyphens.');
      const pair = await generateDkimKey();
      const row = await repo.add({ domain, selector, privateKey: pair.privateKey, publicKey: pair.publicKey, createdBy: input.createdBy ?? null }, now());
      if (row === null) throw new DkimKeyError('exists', `${domain} already has a key under ${selector}.`);
      return viewOf(row);
    },

    /** The domain's key as the screen shows it; null when it has none. */
    async forDomain(domain: string): Promise<DkimKeyView | null> {
      const row = await repo.forDomain(domain);
      return row === null ? null : viewOf(row);
    },

    async list(): Promise<DkimKeyView[]> {
      return (await repo.list()).map(viewOf);
    },

    /** nodemailer's `dkim` options for mail from the domain; null when it has no key, or its key no longer decrypts. */
    async signingOptionsFor(domain: string): Promise<DkimSignOptions | null> {
      const row = await repo.forDomain(domain);
      if (row === null) return null;
      try {
        const privateKey = await repo.privateKeyOf(row.id);
        return privateKey === null ? null : dkimSignOptions({ domain: row.domain, selector: row.selector, privateKey });
      } catch {
        return null;
      }
    },

    remove: (id: string) => repo.remove(id),
  };
}

export type DkimKeys = ReturnType<typeof createDkimKeys>;
