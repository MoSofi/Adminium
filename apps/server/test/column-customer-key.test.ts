// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CUSTOMER'S KEY — a column that says "the same person" without saying
 * who. It is made by Adminium from the address beside it, whenever that
 * address is written, and by nobody else: no form, import or hook value for
 * it is kept. The same address is the same key however it is spelled; the
 * same address in another database is another key.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ruleDecidedColumns } from '../src/crud/decided-columns.js';
import type { WriteContext } from '../src/crud/write-context.js';
import { createWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { customerKey, customerKeyOf, customerKeySecret, installCustomerKey } from '../src/public-api/customer-key.js';
import { TEST_SECRET } from './helpers.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const IMPORT: WriteContext = { origin: 'import', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };

const MEMBERS = {
  ref: 'members',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'name', type: 'text', maxLength: 80, nullable: true },
    { ref: 'email', type: 'text', maxLength: 200, nullable: true },
    { ref: 'member_key', type: 'text', maxLength: 64, nullable: true, rules: { customerKey: { of: 'email' } } },
  ],
};

describe('a customer\'s key', () => {
  const secret = customerKeySecret(TEST_SECRET);

  it('is the same for one address however it is spelled, and another for another address', () => {
    const key = customerKey(secret, 'conn_a', 'ava@example.com');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(customerKey(secret, 'conn_a', '  Ava@Example.COM ')).toBe(key);
    expect(customerKey(secret, 'conn_a', 'ava+shop@example.com')).not.toBe(key);
    expect(customerKey(secret, 'conn_a', 'a.va@example.com')).not.toBe(key);
  });

  it('is another key in another database, and under another secret: one lifted from here tells nothing there', () => {
    const key = customerKey(secret, 'conn_a', 'ava@example.com');
    expect(customerKey(secret, 'conn_b', 'ava@example.com')).not.toBe(key);
    expect(customerKeyOf('another-secret-of-the-same-length-000')('conn_a', 'ava@example.com')).not.toBe(key);
    // The connection and the address are told apart: no pair reads as another.
    expect(customerKey(secret, 'conn_a', 'b@x.dev')).not.toBe(customerKey(secret, 'conn_', 'ab@x.dev'));
    expect(customerKeyOf(TEST_SECRET)('conn_a', 'ava@example.com')).toBe(key);
  });
});

describe.each(LEGS)('a column that keeps a customer\'s key — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  const keyOf = (address: string) => customerKeyOf(TEST_SECRET)(h!.connectionId, address);
  const stored = async (id: unknown) => (await h!.rows(`SELECT email, member_key FROM ${h!.real('members')} WHERE id = ${String(id)}`))[0]!;

  beforeAll(async () => {
    if (!available) return;
    installCustomerKey(TEST_SECRET);
    h = await installInvoicing(dialect, { ...invoicingManifest([MEMBERS]), compatibility: { minAdminiumVersion: '0.3.18' } });
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => h?.close());

  it.skipIf(!available)('the key follows the address: made on a create, made again when the address changes, emptied with it, left alone otherwise', async () => {
    const made = await w.create('members', { name: 'Ava', email: 'Ava@Example.com' });
    expect(made['member_key']).toBe(keyOf('ava@example.com'));
    const id = made['id'];
    await w.update('members', id, { name: 'Ava Reyes' });
    expect((await stored(id))['member_key']).toBe(keyOf('ava@example.com'));
    await w.update('members', id, { email: 'reyes@example.com' });
    expect((await stored(id))['member_key']).toBe(keyOf('reyes@example.com'));
    await w.update('members', id, { email: null });
    expect((await stored(id))['member_key']).toBeNull();
    // A row made with no address has no key.
    expect((await w.create('members', { name: 'Nobody' }))['member_key'] ?? null).toBeNull();
  });

  it.skipIf(!available)('no writer\'s value for the key is kept: a form\'s, a change\'s or an import\'s', async () => {
    const forged = 'f'.repeat(64);
    const made = await w.create('members', { email: 'noor@example.com', member_key: forged });
    expect(made['member_key']).toBe(keyOf('noor@example.com'));
    await w.update('members', made['id'], { member_key: forged });
    expect((await stored(made['id']))['member_key']).toBe(keyOf('noor@example.com'));
    // A change that sends a key and no address leaves the key the address made.
    await w.update('members', made['id'], { name: 'Noor', member_key: null });
    expect((await stored(made['id']))['member_key']).toBe(keyOf('noor@example.com'));
    // An import's row: the key it brings is dropped, and its address makes one.
    const checked = await w.writes.check('create', w.targetOf('members'), IMPORT, [{ email: 'sam@example.com', member_key: forged }, { name: 'No address', member_key: forged }], { capacity: 'unchecked' });
    expect(checked.issues).toEqual([null, null]);
    expect(checked.rows.map((row) => (row as Record<string, unknown> | null)?.['member_key'] ?? null)).toEqual([keyOf('sam@example.com'), null]);
  });

  it.skipIf(!available)('the column is one Adminium decides: a guest\'s entry may not list it', async () => {
    const table = w.view.model.tables.find((candidate) => candidate.name === h!.real('members'))!;
    expect([...ruleDecidedColumns(table, w.view.model)]).toContain('member_key');
  });

  it.skipIf(!available)('every write service built from the meta store\'s own stores carries the function; one built bare refuses to save a keyed row with no key', async () => {
    expect(typeof writeStores(h!.meta).customerKey).toBe('function');
    const bare = createWriteService({});
    const run = bare.create({ target: w.targetOf('members'), values: { email: 'x@example.com' }, context: w.desk, announce: async () => {} });
    await expect(run).rejects.toThrow(/keeps a customer key/);
    expect(Number((await h!.rows(`SELECT COUNT(*) AS n FROM ${h!.real('members')} WHERE email = 'x@example.com'`))[0]!['n'])).toBe(0);
  });
});
