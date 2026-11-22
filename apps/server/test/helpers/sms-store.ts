// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SMS account store for tests, and the contract any store must meet. The
 * real one waits for its migration: at merge, run {@link describeSmsStoreContract}
 * over it on SQLite, Postgres and MySQL.
 */
import { describe, expect, it } from 'vitest';

import type { SmsAccountFields, SmsAccountRow, SmsAccountStore } from '../../src/sms/store.js';

export function memorySmsStore(): SmsAccountStore & { row: SmsAccountRow | null; writes: SmsAccountFields[] } {
  const store = {
    row: null as SmsAccountRow | null,
    writes: [] as SmsAccountFields[],
    async read() {
      return store.row === null ? null : { ...store.row };
    },
    async write(fields: SmsAccountFields, expected: number | null) {
      if ((store.row?.revision ?? null) !== expected) return null;
      store.writes.push(fields);
      store.row = { ...fields, revision: (expected ?? 0) + 1 };
      return { ...store.row };
    },
    async remove(expected: number) {
      if (store.row?.revision !== expected) return false;
      store.row = null;
      return true;
    },
  };
  return store;
}

const FIELDS: SmsAccountFields = {
  provider: 'twilio',
  sealedCredentials: 'enc:v1:not-a-real-token',
  accountName: 'Lu•••ic',
  accountHint: '…abcd',
  accountType: 'full',
  sender: { kind: 'number', value: '+14155552671' },
  defaultCountry: 'US',
  check: { ok: true, reason: null, at: 1 },
  savedAt: 1,
  savedBy: null,
};

export function describeSmsStoreContract(name: string, make: () => Promise<SmsAccountStore>): void {
  describe(`SMS account store contract: ${name}`, () => {
    it('starts empty, and reads back what was written', async () => {
      const store = await make();
      expect(await store.read()).toBeNull();
      const row = await store.write(FIELDS, null);
      expect(row).toMatchObject({ ...FIELDS, revision: 1 });
      expect(await store.read()).toEqual(row);
    });

    it('refuses a write from a stale revision and changes nothing', async () => {
      const store = await make();
      const first = (await store.write(FIELDS, null))!;
      const second = (await store.write({ ...FIELDS, accountHint: '…bbbb' }, first.revision))!;
      expect(second.revision).toBeGreaterThan(first.revision);
      expect(await store.write({ ...FIELDS, accountHint: '…cccc' }, first.revision)).toBeNull();
      expect(await store.write({ ...FIELDS, accountHint: '…dddd' }, null)).toBeNull();
      expect((await store.read())?.accountHint).toBe('…bbbb');
    });

    it('removes only at the current revision', async () => {
      const store = await make();
      const first = (await store.write(FIELDS, null))!;
      expect(await store.remove(first.revision + 1)).toBe(false);
      expect(await store.read()).not.toBeNull();
      expect(await store.remove(first.revision)).toBe(true);
      expect(await store.read()).toBeNull();
    });
  });
}
