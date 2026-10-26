// SPDX-License-Identifier: AGPL-3.0-only
/**
 * emailDkimKeysRepo — adminium_email_dkim_keys (0068).
 *
 * A sending domain's DKIM key. The private key is encrypted with closures
 * the server hands in (a key of its own purpose); every read gives the public
 * key and never the private one, and `privateKeyOf` is the one door to it,
 * read only where a mail is signed.
 *
 * Domains are kept in lower case, as DNS compares them.
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumEmailDkimKeysTable } from '../schema/tables.js';
import type { DsnCrypto } from './connections.js';
import { MetaValidationError, affected, isDuplicateKeyError } from './util.js';

export const DKIM_DOMAIN_MAX = 253;
export const DKIM_SELECTOR_MAX = 63;

export interface DkimKeyRow {
  id: string;
  domain: string;
  selector: string;
  /** Base64 of the public key's DER: the record's `p=`. */
  publicKey: string;
  createdBy: string | null;
  createdAt: number;
}

export interface AddDkimKeyInput {
  domain: string;
  selector: string;
  /** PEM, in the clear; encrypted here. */
  privateKey: string;
  publicKey: string;
  createdBy?: string | null;
}

/** The columns every read takes: never the private key. */
const PUBLIC_COLUMNS = ['id', 'domain', 'selector', 'publicKey', 'createdBy', 'createdAt'] as const;

function decode(row: Pick<Selectable<AdminiumEmailDkimKeysTable>, (typeof PUBLIC_COLUMNS)[number]>): DkimKeyRow {
  return { id: row.id, domain: row.domain, selector: row.selector, publicKey: row.publicKey, createdBy: row.createdBy, createdAt: Number(row.createdAt) };
}

export function emailDkimKeysRepo(meta: MetaDb, crypto: DsnCrypto) {
  const { db } = meta;
  const table = 'adminium_email_dkim_keys' as const;

  async function byId(id: string): Promise<DkimKeyRow | null> {
    const row = await db.selectFrom(table).select(PUBLIC_COLUMNS).where('id', '=', id).executeTakeFirst();
    return row === undefined ? null : decode(row);
  }

  return {
    byId,

    /** A new key; null when the domain already has one under that selector. */
    async add(input: AddDkimKeyInput, now = Date.now()): Promise<DkimKeyRow | null> {
      const domain = input.domain.trim().toLowerCase();
      if (domain.length === 0 || domain.length > DKIM_DOMAIN_MAX) throw new MetaValidationError(`a DKIM domain is 1–${String(DKIM_DOMAIN_MAX)} characters`);
      if (input.selector.length === 0 || input.selector.length > DKIM_SELECTOR_MAX) throw new MetaValidationError(`a DKIM selector is 1–${String(DKIM_SELECTOR_MAX)} characters`);
      const id = newId('dkim');
      try {
        await db
          .insertInto(table)
          .values({
            id,
            domain,
            selector: input.selector,
            privateKeyEncrypted: crypto.encrypt(input.privateKey),
            publicKey: input.publicKey,
            createdBy: input.createdBy ?? null,
            createdAt: now,
          })
          .execute();
      } catch (error) {
        if (isDuplicateKeyError(error)) return null;
        throw error;
      }
      return byId(id);
    },

    /** The domain's newest key, or null when it has none. */
    async forDomain(domain: string): Promise<DkimKeyRow | null> {
      const row = await db
        .selectFrom(table)
        .select(PUBLIC_COLUMNS)
        .where('domain', '=', domain.trim().toLowerCase())
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    async list(): Promise<DkimKeyRow[]> {
      const rows = await db.selectFrom(table).select(PUBLIC_COLUMNS).orderBy('domain').orderBy('createdAt').orderBy('id').execute();
      return rows.map(decode);
    },

    /** The private key in the clear (PEM), for signing; null when there is no such key. */
    async privateKeyOf(id: string): Promise<string | null> {
      const row = await db.selectFrom(table).select('privateKeyEncrypted').where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : crypto.decrypt(row.privateKeyEncrypted);
    },

    async remove(id: string): Promise<boolean> {
      const done = await db.deleteFrom(table).where('id', '=', id).executeTakeFirst();
      return affected(done.numDeletedRows) > 0;
    },
  };
}
