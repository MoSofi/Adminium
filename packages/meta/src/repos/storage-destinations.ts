// SPDX-License-Identifier: AGPL-3.0-only
/**
 * destinationsRepo — adminium_storage_destinations (37-files-and-storage.md
 * §3.2, D2).
 *
 * One row per configured place bytes may live. THIS SERVER'S DISK IS NOT ONE
 * OF THEM (D3): `adminium_files.destination_id IS NULL` means `<dataDir>/files`
 * and always has, so a store with no rows here behaves exactly as it did
 * before wave 0024.
 *
 * Secrets follow the connection-DSN pattern to the letter: this package stays
 * crypto-agnostic and the caller injects {@link DsnCrypto} closures built from
 * its own `ADMINIUM_SECRET` derivation (a different HKDF salt —
 * `adminium:storage:v1` — so a leaked storage key never opens a DSN).
 * `list()` and `findById()` NEVER decrypt: they report `hasSecret` and nothing
 * more, which is what every read path except the driver factory needs (D16).
 * `getSecret()` is the one door, and it is deliberately separate so a route
 * that renders a destination cannot accidentally serialize a credential.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  parseStorageDestinationConfig,
  storageDestinationStatusSchema,
  storageDriverSchema,
  type StorageDestinationConfig,
  type StorageDestinationStatus,
  type StorageDriverKind,
} from '../schema/json-payloads.js';
import type { AdminiumStorageDestinationsTable } from '../schema/tables.js';
import type { DsnCrypto } from './connections.js';
import { MetaValidationError, affected, packJson, readBool, readJson, writeBool } from './util.js';

/** A destination as every read path sees it — config yes, credential never. */
export interface StorageDestination {
  id: string;
  name: string;
  driver: StorageDriverKind;
  config: StorageDestinationConfig;
  /** True when a credential is stored; the credential itself never leaves the repo here. */
  hasSecret: boolean;
  isDefault: boolean;
  status: StorageDestinationStatus;
  lastTestedAt: number | null;
  lastError: string | null;
  disabled: boolean;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateDestinationInput {
  name: string;
  driver: StorageDriverKind;
  config: unknown;
  /** Plaintext credential; encrypted here. Omit for `local`. */
  secret?: unknown;
  createdBy?: string | null;
  /** Make this the default in the same transaction that creates it (the seed does). */
  makeDefault?: boolean;
}

export interface UpdateDestinationInput {
  name?: string;
  config?: unknown;
  /**
   * `undefined` leaves the stored credential alone — the editor sends a secret
   * only when the operator typed a new one (D16). `null` clears it.
   */
  secret?: unknown | null;
  disabled?: boolean;
}

/** The Test button's verdict, written back to the row. */
export interface DestinationProbeResult {
  ok: boolean;
  error?: string | null;
  at?: number;
}

/** A destination still holds files; the repo refuses before the FK does (D20). */
export class DestinationInUseError extends Error {
  override readonly name = 'DestinationInUseError';
  constructor(readonly destinationId: string, readonly fileCount: number) {
    super(
      `storage destination ${destinationId} still holds ${String(fileCount)} file(s); ` +
        'move them to another destination before deleting it',
    );
  }
}

function decode(row: Selectable<AdminiumStorageDestinationsTable>): StorageDestination {
  const driver = storageDriverSchema.parse(row.driver);
  return {
    id: row.id,
    name: row.name,
    driver,
    config: parseStorageDestinationConfig(driver, readJson(row.config)),
    hasSecret: row.secretEncrypted !== null,
    isDefault: readBool(row.isDefault),
    status: storageDestinationStatusSchema.parse(row.status),
    lastTestedAt: row.lastTestedAt,
    lastError: row.lastError,
    disabled: row.disabledAt !== null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function destinationsRepo(meta: MetaDb, crypto: DsnCrypto) {
  const { db } = meta;

  function encodeSecret(secret: unknown): string | null {
    if (secret === null || secret === undefined) return null;
    return crypto.encrypt(typeof secret === 'string' ? secret : JSON.stringify(secret));
  }

  async function findById(id: string): Promise<StorageDestination | null> {
    const row = await db
      .selectFrom('adminium_storage_destinations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? null : decode(row);
  }

  /**
   * At most one row may carry `is_default`. Enforced by clearing every other
   * row inside the SAME transaction that sets this one, rather than by a
   * partial unique index — which postgres supports, MySQL does not, and SQLite
   * spells differently.
   *
   * THE CLEAR-THEN-SET PAIR IS NOT ENOUGH ON ITS OWN, and the first version of
   * this repo shipped without the lock below until the postgres leg of
   * `migrations.file-destinations.test.ts` caught it. Under READ COMMITTED two
   * concurrent calls interleave as:
   *
   *   T1 clear (nothing is flagged yet) → T2 clear (T1's set is uncommitted, so
   *   still nothing) → T1 set A → T2 set B → two defaults.
   *
   * The clear can only lock rows that are ALREADY flagged, and at first
   * configuration none are. So the transaction opens by locking the whole
   * (tiny) set of destinations FOR UPDATE, in id order — ordered so three
   * racing callers queue rather than deadlock on each other's rows. SQLite
   * takes no lock clause because it has no readers-block-writers problem to
   * solve here: its writes serialize at the connection.
   */
  async function setDefault(id: string, at: number = Date.now()): Promise<boolean> {
    return db.transaction().execute(async (trx) => {
      const lock = trx.selectFrom('adminium_storage_destinations').select('id').orderBy('id', 'asc');
      const held = await (meta.dialect === 'sqlite' ? lock : lock.forUpdate()).execute();
      if (!held.some((row) => row.id === id)) return false;
      await trx
        .updateTable('adminium_storage_destinations')
        .set({ isDefault: writeBool(meta, false), updatedAt: at })
        .where('id', '!=', id)
        .where('isDefault', '=', writeBool(meta, true))
        .execute();
      await trx
        .updateTable('adminium_storage_destinations')
        .set({ isDefault: writeBool(meta, true), updatedAt: at })
        .where('id', '=', id)
        .execute();
      return true;
    });
  }

  return {
    findById,
    setDefault,

    async list(): Promise<StorageDestination[]> {
      const rows = await db
        .selectFrom('adminium_storage_destinations')
        .selectAll()
        .orderBy('createdAt', 'asc')
        .execute();
      return rows.map(decode);
    },

    async findByName(name: string): Promise<StorageDestination | null> {
      const row = await db
        .selectFrom('adminium_storage_destinations')
        .selectAll()
        .where('name', '=', name)
        .executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /** The destination new bytes go to, or null when this server's disk is it (D3). */
    async findDefault(): Promise<StorageDestination | null> {
      const row = await db
        .selectFrom('adminium_storage_destinations')
        .selectAll()
        .where('isDefault', '=', writeBool(meta, true))
        .executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /** True when no destination is configured at all — the seed's one precondition (D15). */
    async isEmpty(): Promise<boolean> {
      const row = await db
        .selectFrom('adminium_storage_destinations')
        .select('id')
        .limit(1)
        .executeTakeFirst();
      return row === undefined;
    },

    /**
     * The stored credential, decrypted. The ONLY door — see the header. Throws
     * whatever the injected `decrypt` throws when the secret no longer matches,
     * which the server turns into its purpose-built mismatch error.
     */
    async getSecret(id: string): Promise<string | null> {
      const row = await db
        .selectFrom('adminium_storage_destinations')
        .select('secretEncrypted')
        .where('id', '=', id)
        .executeTakeFirst();
      if (row === undefined || row.secretEncrypted === null) return null;
      return crypto.decrypt(row.secretEncrypted);
    },

    async create(input: CreateDestinationInput, at: number = Date.now()): Promise<StorageDestination> {
      const driver = storageDriverSchema.safeParse(input.driver);
      if (!driver.success) {
        throw new MetaValidationError(`unknown storage driver ${JSON.stringify(input.driver)}`, driver.error.issues);
      }
      const config = parseStorageDestinationConfig(driver.data, input.config);
      const id = newId('dest');
      const row = {
        id,
        name: input.name,
        driver: driver.data,
        config: packJson(config),
        secretEncrypted: encodeSecret(input.secret),
        isDefault: writeBool(meta, false),
        status: 'untested',
        lastTestedAt: null,
        lastError: null,
        disabledAt: null,
        createdBy: input.createdBy ?? null,
        createdAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_storage_destinations').values(row).execute();
      if (input.makeDefault === true) await setDefault(id, at);
      const created = await findById(id);
      if (created === null) throw new MetaValidationError(`destination ${id} vanished after insert`);
      return created;
    },

    async update(
      id: string,
      input: UpdateDestinationInput,
      at: number = Date.now(),
    ): Promise<StorageDestination | null> {
      const current = await findById(id);
      if (current === null) return null;
      const patch: Record<string, unknown> = { updatedAt: at };
      if (input.name !== undefined) patch['name'] = input.name;
      if (input.config !== undefined) {
        patch['config'] = packJson(parseStorageDestinationConfig(current.driver, input.config));
      }
      // `undefined` = keep what is stored; `null` = clear it. The editor never
      // round-trips a secret it did not see, so "keep" is the common case.
      if (input.secret !== undefined) patch['secretEncrypted'] = encodeSecret(input.secret);
      if (input.disabled !== undefined) patch['disabledAt'] = input.disabled ? at : null;
      await db.updateTable('adminium_storage_destinations').set(patch).where('id', '=', id).execute();
      return findById(id);
    },

    /** Records the Test button's verdict; `status` is derived, never passed in. */
    async recordProbe(
      id: string,
      result: DestinationProbeResult,
      at: number = Date.now(),
    ): Promise<StorageDestination | null> {
      await db
        .updateTable('adminium_storage_destinations')
        .set({
          status: result.ok ? 'ok' : 'error',
          lastTestedAt: result.at ?? at,
          lastError: result.ok ? null : (result.error ?? 'unknown error'),
          updatedAt: at,
        })
        .where('id', '=', id)
        .execute();
      return findById(id);
    },

    /** Rows (including trashed ones) still pointing at this destination. */
    async countFiles(id: string): Promise<number> {
      const row = await db
        .selectFrom('adminium_files')
        .select((eb) => eb.fn.countAll<number | string | bigint>().as('n'))
        .where('destinationId', '=', id)
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    /**
     * Refuses while the destination holds files, naming the count (D20) — the
     * FK is RESTRICT underneath, but a constraint violation is not an error an
     * operator can act on and "12 files live here" is.
     */
    async remove(id: string): Promise<boolean> {
      const held = await db
        .selectFrom('adminium_files')
        .select((eb) => eb.fn.countAll<number | string | bigint>().as('n'))
        .where('destinationId', '=', id)
        .executeTakeFirst();
      const count = Number(held?.n ?? 0);
      if (count > 0) throw new DestinationInUseError(id, count);
      const res = await db
        .deleteFrom('adminium_storage_destinations')
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(res.numDeletedRows) === 1;
    },
  };
}

export type DestinationsRepo = ReturnType<typeof destinationsRepo>;
