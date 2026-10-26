// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ADDRESS KEYS — what the consent log and the stop list hash an address
 * under, and how they survive a change of `ADMINIUM_SECRET`.
 *
 * An address is compared as every door compares one (`normaliseAddress`:
 * trimmed, in lower case, nothing more; never `anonymous-caps.ts`'s folding,
 * which would merge two people) and hashed with `hashAddress`, an HMAC.
 *
 * ─── Why the key is not taken from the secret ──────────────────────────────
 * Every other keyed hash in the server is taken from `ADMINIUM_SECRET`, so it
 * matches nobody once the secret changes. A stop list that silently stopped
 * matching would mail everyone who objected. So the key here is 32 random
 * bytes made once per install, kept in `adminium_address_keys` encrypted under
 * a key that IS taken from the secret. A change of secret re-encrypts those
 * few rows (and the stop list's display copies) with {@link resealUnderNewSecret};
 * no hash changes, so every entry keeps matching, an erased person's (which
 * keeps the hash alone) included.
 *
 * ─── Fail closed ───────────────────────────────────────────────────────────
 * The server has no rotation command today: the deploy guide says to never
 * change the secret, because every stored connection string is lost with it.
 * If the secret changes anyway, the stored key cannot be read, and every read
 * here throws {@link AddressKeysLockedError} instead of answering "not on the
 * list". A key is made only while there is none at all, never beside one that
 * cannot be read.
 *
 * ─── Versions ──────────────────────────────────────────────────────────────
 * A key is replaced (should it ever leak) by {@link renewAddressKey}: a new
 * version, and every entry that still has its address is hashed again under
 * it. An erased person's entry cannot be, so it stays under its version, and
 * every lookup hashes the address under every version there is.
 */
import { randomBytes } from 'node:crypto';

import { addressKeysRepo, stopListRepo, type AddressHash, type MetaDb } from '@adminium/meta';

import { decryptSecret, deriveKey, encryptSecret, SecretFormatError, SecretIntegrityError } from '../config/secrets.js';
import { hashAddress, normaliseAddress } from '../public-api/claim-code.js';

/** The stored keys can't be read with this server's secret: nothing is answered rather than a wrong "no". */
export class AddressKeysLockedError extends Error {
  override readonly name = 'AddressKeysLockedError';
  constructor() {
    super('The keys the do-not-email list is hashed under cannot be read with this server\'s ADMINIUM_SECRET. It was changed without re-encrypting them; until it is put back, no marketing mail can be checked against the list.');
  }
}

/** What the address keys are encrypted under: its own derivation from the server's secret. */
export function addressKeysWrapKey(secret: string): Buffer {
  return deriveKey(secret, 'adminium-address-keys-v1', 'adminium:address-keys');
}

/** What a stop-list entry's display address is encrypted under. */
export function stopListAddressKey(secret: string): Buffer {
  return deriveKey(secret, 'adminium-stop-list-v1', 'adminium:stop-list-address');
}

const KEY_BYTES = 32;

function openKey(token: string, wrap: Buffer): Buffer {
  try {
    const key = Buffer.from(decryptSecret(token, wrap), 'base64');
    if (key.length !== KEY_BYTES) throw new SecretFormatError('an address key must be 32 bytes');
    return key;
  } catch (error) {
    if (error instanceof SecretIntegrityError || error instanceof SecretFormatError) throw new AddressKeysLockedError();
    throw error;
  }
}

export interface AddressKeyRing {
  /** The address under the newest key version: what a new row is written with. Makes the first key when there is none. */
  hashForWrite(address: string): Promise<AddressHash>;
  /** The address under every version there is, newest first: what a lookup matches. Empty while there is no key. */
  hashesOf(address: string): Promise<AddressHash[]>;
  /** Many addresses at once, each under every version (one read of the keys). */
  hashesOfMany(addresses: readonly string[]): Promise<Map<string, AddressHash[]>>;
  /** The address under one version (a re-hash). */
  hashUnder(address: string, version: number): Promise<AddressHash>;
}

/**
 * The keys as this process reads them. Each call reads the version list
 * (a few rows), so a version another process made is used at once; a key is
 * decrypted once per version and kept.
 */
export function addressKeyRing(meta: MetaDb, secret: string): AddressKeyRing {
  const repo = addressKeysRepo(meta);
  const wrap = addressKeysWrapKey(secret);
  const opened = new Map<string, Buffer>();

  async function keys(): Promise<{ version: number; key: Buffer }[]> {
    const stored = await repo.all();
    return stored.map((row) => {
      const cacheKey = `${String(row.version)}:${row.keyEncrypted}`;
      let key = opened.get(cacheKey);
      if (key === undefined) {
        key = openKey(row.keyEncrypted, wrap);
        opened.set(cacheKey, key);
      }
      return { version: row.version, key };
    });
  }

  async function newest(): Promise<{ version: number; key: Buffer }> {
    const all = await keys();
    const last = all.at(-1);
    if (last !== undefined) return last;
    // None yet: the first, made once. Two processes making it at once: the one written wins, and both use it.
    await repo.create({ version: 1, keyEncrypted: encryptSecret(randomBytes(KEY_BYTES).toString('base64'), wrap), createdAt: Date.now() });
    const made = (await keys()).at(-1);
    if (made === undefined) throw new Error('The first address key could not be made.');
    return made;
  }

  return {
    async hashForWrite(address) {
      const { version, key } = await newest();
      return { hash: hashAddress(key, address), version };
    },
    async hashesOf(address) {
      return (await keys()).reverse().map(({ version, key }) => ({ hash: hashAddress(key, address), version }));
    },
    async hashesOfMany(addresses) {
      const all = (await keys()).reverse();
      return new Map(addresses.map((address) => [address, all.map(({ version, key }) => ({ hash: hashAddress(key, address), version }))]));
    },
    async hashUnder(address, version) {
      const found = (await keys()).find((one) => one.version === version);
      if (found === undefined) throw new Error(`No address key of version ${String(version)}.`);
      return { hash: hashAddress(found.key, address), version };
    },
  };
}

/** A display address, encrypted (as `normaliseAddress` spells it). */
export function sealAddress(secret: string, address: string): string {
  return encryptSecret(normaliseAddress(address), stopListAddressKey(secret));
}

/** A display address, read; throws {@link AddressKeysLockedError} under a secret that did not seal it. */
export function openAddress(secret: string, sealed: string): string {
  try {
    return decryptSecret(sealed, stopListAddressKey(secret));
  } catch (error) {
    if (error instanceof SecretIntegrityError || error instanceof SecretFormatError) throw new AddressKeysLockedError();
    throw error;
  }
}

/**
 * THE SECRET CHANGED: the address keys and every display address,
 * re-encrypted from the old secret to the new one, in one transaction. No hash
 * changes. Whatever already reads under the new secret is left as it is, so
 * a run cut short is finished by running it again. Returns how many rows were
 * re-encrypted.
 */
export async function resealUnderNewSecret(meta: MetaDb, input: { from: string; to: string }): Promise<{ keys: number; entries: number }> {
  const fromWrap = addressKeysWrapKey(input.from);
  const toWrap = addressKeysWrapKey(input.to);
  const fromSeal = stopListAddressKey(input.from);
  const toSeal = stopListAddressKey(input.to);
  const reads = (token: string, key: Buffer): string | null => {
    try {
      return decryptSecret(token, key);
    } catch (error) {
      if (error instanceof SecretIntegrityError || error instanceof SecretFormatError) return null;
      throw error;
    }
  };
  return meta.db.transaction().execute(async (trx) => {
    const inTrx = { ...meta, db: trx } as MetaDb;
    let keys = 0;
    let entries = 0;
    const keyRepo = addressKeysRepo(inTrx);
    for (const row of await keyRepo.all()) {
      if (reads(row.keyEncrypted, toWrap) !== null) continue;
      const plain = reads(row.keyEncrypted, fromWrap);
      if (plain === null) throw new AddressKeysLockedError();
      await keyRepo.reseal(row.version, encryptSecret(plain, toWrap));
      keys += 1;
    }
    const list = stopListRepo(inTrx);
    for (let page = await list.scan({ limit: 500 }); page.length > 0; page = await list.scan({ afterId: page.at(-1)!.id, limit: 500 })) {
      for (const entry of page) {
        if (entry.addressEncrypted === null || reads(entry.addressEncrypted, toSeal) !== null) continue;
        const plain = reads(entry.addressEncrypted, fromSeal);
        if (plain === null) throw new AddressKeysLockedError();
        await list.reseal(entry.id, encryptSecret(plain, toSeal));
        entries += 1;
      }
    }
    return { keys, entries };
  });
}

/**
 * A NEW KEY VERSION (the old one may have leaked): every stop-list entry that
 * still has its address is hashed again under it. An erased person's entry
 * stays under its version, which is kept and still matched. The consent log's
 * rows keep the version they were written under. Returns the new version and
 * how many entries moved.
 */
export async function renewAddressKey(meta: MetaDb, secret: string): Promise<{ version: number; rehashed: number }> {
  const repo = addressKeysRepo(meta);
  const wrap = addressKeysWrapKey(secret);
  const all = await repo.all();
  // Every stored key must still read: a new version beside a locked one would hide the entries under it.
  for (const row of all) openKey(row.keyEncrypted, wrap);
  const version = (all.at(-1)?.version ?? 0) + 1;
  if (!(await repo.create({ version, keyEncrypted: encryptSecret(randomBytes(KEY_BYTES).toString('base64'), wrap), createdAt: Date.now() }))) {
    throw new Error(`Address key version ${String(version)} was made by another process at the same moment.`);
  }
  const ring = addressKeyRing(meta, secret);
  const list = stopListRepo(meta);
  let rehashed = 0;
  for (let page = await list.scan({ limit: 500 }); page.length > 0; page = await list.scan({ afterId: page.at(-1)!.id, limit: 500 })) {
    for (const entry of page) {
      if (entry.addressEncrypted === null || entry.address.version === version) continue;
      const address = openAddress(secret, entry.addressEncrypted);
      // The same address already under the new version (added while this ran): this row is the older copy.
      if (await list.rehash(entry.id, await ring.hashUnder(address, version))) rehashed += 1;
      else await list.remove(entry.id);
    }
  }
  return { version, rehashed };
}
