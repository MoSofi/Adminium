// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MetaValidationError,
  connectionsRepo,
  filesRepo,
  firstRun,
  overridesRepo,
  snapshotsRepo,
  type DsnCrypto,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

/** Reversible stand-in for the server's AES closures — meta stays crypto-agnostic. */
const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => {
    if (!token.startsWith('enc:test:')) throw new Error('not an encrypted token');
    return Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8');
  },
};

const MODEL_A = { dialect: 'postgres', name: 'northwind', tables: [{ name: 'customers' }] };
const MODEL_B = { dialect: 'postgres', name: 'northwind', tables: [{ name: 'customers' }, { name: 'orders' }] };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`connections/snapshots/overrides repos [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
      await firstRun(t.meta);
    });
    afterEach(async () => {
      await t.destroy();
    });

    describe('connectionsRepo', () => {
      it('encrypts DSNs at rest and round-trips them through getDsns()', async () => {
        const repo = connectionsRepo(t.meta, testCrypto);
        const created = await repo.create({
          name: 'prod-db',
          engine: 'postgres',
          introspectDsn: 'postgres://ro:secret@db.acme.io:5432/prod',
          dataDsn: 'postgres://rw:secret2@db.acme.io:5432/prod',
        });

        expect(created.introspectDsnEncrypted).toMatch(/^enc:test:/);
        expect(created.introspectDsnEncrypted).not.toContain('secret');
        expect(created.dataDsnEncrypted).not.toContain('secret2');

        const dsns = await repo.getDsns(created.id);
        expect(dsns).toEqual({
          introspectDsn: 'postgres://ro:secret@db.acme.io:5432/prod',
          dataDsn: 'postgres://rw:secret2@db.acme.io:5432/prod',
        });
      });

      it('falls back dataDsn → introspectDsn for single-role setups (§3.13)', async () => {
        const repo = connectionsRepo(t.meta, testCrypto);
        const created = await repo.create({
          name: 'dev',
          engine: 'postgres',
          introspectDsn: 'postgres://one@localhost/dev',
        });
        const dsns = await repo.getDsns(created.id);
        expect(dsns?.dataDsn).toBe('postgres://one@localhost/dev');
      });

      it('rejects unknown engines, missing DSN, and bad settings payloads', async () => {
        const repo = connectionsRepo(t.meta, testCrypto);
        await expect(repo.create({ name: 'x', engine: 'oracle', introspectDsn: 'x' })).rejects.toThrow(
          MetaValidationError,
        );
        await expect(repo.create({ name: 'x', engine: 'postgres' })).rejects.toThrow(MetaValidationError);
        await expect(
          repo.create({
            name: 'x',
            engine: 'postgres',
            introspectDsn: 'postgres://a@b/c',
            settings: { intent: 'nope' } as never,
          }),
        ).rejects.toThrow(MetaValidationError);
      });

      it('update, recordTestResult, list ordering, and delete', async () => {
        const repo = connectionsRepo(t.meta, testCrypto);
        const a = await repo.create(
          { name: 'a', engine: 'postgres', introspectDsn: 'postgres://a@h/d' },
          1_000,
        );
        const b = await repo.create(
          { name: 'b', engine: 'sqlite', sourceKind: 'dsn', introspectDsn: 'sqlite:///tmp/x.db' },
          2_000,
        );
        expect((await repo.list()).map((c) => c.name)).toEqual(['a', 'b']);

        const updated = await repo.update(a.id, { name: 'a2', readOnly: true, status: 'connected' }, 3_000);
        expect(updated?.name).toBe('a2');
        expect(updated?.readOnly).toBe(true);
        expect(updated?.status).toBe('connected');
        expect(updated?.updatedAt).toBe(3_000);

        await repo.recordTestResult(
          b.id,
          { ok: false, latencyMs: 12, error: 'boom', errorHint: 'try the unpooled host' },
          4_000,
        );
        const failed = await repo.findById(b.id);
        expect(failed?.status).toBe('error');
        expect(failed?.lastError).toBe('boom');
        expect(failed?.lastErrorHint).toBe('try the unpooled host');
        expect(failed?.lastTestedAt).toBe(4_000);

        await repo.recordTestResult(b.id, { ok: true, latencyMs: 8, readOnly: true }, 5_000);
        const healthy = await repo.findById(b.id);
        expect(healthy?.status).toBe('connected');
        expect(healthy?.lastError).toBeNull();
        // Success clears the hint too — a stale one reads as an open problem.
        expect(healthy?.lastErrorHint).toBeNull();
        expect(healthy?.readOnly).toBe(true);

        expect(await repo.delete(a.id)).toBe(true);
        expect(await repo.findById(a.id)).toBeNull();
        expect(await repo.delete(a.id)).toBe(false);
      });

      it('rejects every §3.13 discriminator it does not recognise, before writing', async () => {
        const repo = connectionsRepo(t.meta, testCrypto);
        const base = { name: 'x', engine: 'postgres', introspectDsn: 'postgres://a@b/c' } as const;

        await expect(repo.create({ ...base, sourceKind: 'yaml' })).rejects.toThrow(/source_kind/);
        await expect(repo.create({ ...base, status: 'degraded' })).rejects.toThrow(/status/);
        await expect(
          // @ts-expect-error — `mode` is a fixed three-value enum
          repo.create({ ...base, ssl: { mode: 'prefer' } }),
        ).rejects.toThrow(/ssl/);

        // Each half of the source-kind contract: `dsn` needs a DSN and
        // `schema-file` needs a file, and neither substitutes for the other.
        await expect(repo.create({ name: 'x', engine: 'postgres', sourceKind: 'dsn' })).rejects.toThrow(
          /introspectDsn is required/,
        );
        await expect(
          repo.create({ name: 'x', engine: 'postgres', sourceKind: 'schema-file' }),
        ).rejects.toThrow(/schemaFileId is required/);
        // A DSN does not satisfy a schema-file connection either.
        await expect(repo.create({ ...base, sourceKind: 'schema-file' })).rejects.toThrow(
          /schemaFileId is required/,
        );

        // Every one of those was a refusal, not a half-written row.
        expect(await repo.list()).toEqual([]);
      });

      it('stores a schema-file connection that never had a DSN to decrypt', async () => {
        const repo = connectionsRepo(t.meta, testCrypto);
        const schemaFile = await filesRepo(t.meta).create({
          filename: 'northwind.sql',
          mime: 'application/sql',
          sizeBytes: 2048,
          sha256: 'a'.repeat(64),
          kind: 'schema',
        });
        const created = await repo.create({
          name: 'offline',
          engine: 'postgres',
          sourceKind: 'schema-file',
          schemaFileId: schemaFile.id,
          ssl: { mode: 'verify-full', caFileId: null },
          status: 'connected',
        });

        expect(created).toMatchObject({
          sourceKind: 'schema-file',
          schemaFileId: schemaFile.id,
          introspectDsnEncrypted: null,
          dataDsnEncrypted: null,
          status: 'connected',
        });
        expect(created.ssl).toEqual({ mode: 'verify-full', caFileId: null });

        // `getDsns` must not hand an empty string to the AES closure — there is
        // nothing to decrypt, and the fallback has nothing to fall back to.
        expect(await repo.getDsns(created.id)).toEqual({ introspectDsn: null, dataDsn: null });
        // …and an id that does not exist is null, not a throw.
        expect(await repo.getDsns('conn_missing')).toBeNull();
      });

      it('an empty-string DSN is stored as NULL, not as encrypted emptiness', async () => {
        // The Studio form posts '' for a cleared field. Encrypting it would
        // produce a non-null ciphertext, and `getDsns` would then decrypt it to
        // '' — a DSN-shaped value the connector would actually try to dial.
        const repo = connectionsRepo(t.meta, testCrypto);
        const created = await repo.create({
          name: 'cleared',
          engine: 'postgres',
          introspectDsn: 'postgres://ro@h/d',
          dataDsn: '',
        });
        expect(created.dataDsnEncrypted).toBeNull();
        expect((await repo.getDsns(created.id))?.dataDsn).toBe('postgres://ro@h/d');
      });

      it('update validates each payload it is given and leaves the row alone when it refuses', async () => {
        const repo = connectionsRepo(t.meta, testCrypto);
        const conn = await repo.create(
          {
            name: 'prod',
            engine: 'postgres',
            introspectDsn: 'postgres://ro@h/d',
            ssl: { mode: 'require' },
            settings: { intent: 'crud' },
          },
          1_000,
        );
        expect(conn.ssl).toEqual({ mode: 'require', caFileId: undefined });

        // @ts-expect-error — not a member of the ssl mode enum
        await expect(repo.update(conn.id, { ssl: { mode: 'prefer' } })).rejects.toThrow(/ssl/);
        // @ts-expect-error — not a member of the intent enum
        await expect(repo.update(conn.id, { settings: { intent: 'nope' } })).rejects.toThrow(/settings/);
        await expect(repo.update(conn.id, { status: 'degraded' })).rejects.toThrow(/status/);

        const untouched = await repo.findById(conn.id);
        expect(untouched?.ssl).toEqual({ mode: 'require', caFileId: undefined });
        expect(untouched?.settings).toEqual({ intent: 'crud' });
        expect(untouched?.updatedAt).toBe(1_000);

        // The accepting path: DSNs are re-encrypted, `ssl: null` clears the
        // column rather than storing the string "null", and the failure fields
        // are writable so an operator can clear a resolved error by hand.
        const updated = await repo.update(
          conn.id,
          {
            introspectDsn: 'postgres://ro@h2/d',
            dataDsn: 'postgres://rw@h2/d',
            ssl: null,
            settings: { intent: 'read-only-analytics', includedTables: ['public.orders'] },
            status: 'connected',
            lastError: null,
            lastErrorHint: null,
          },
          2_000,
        );
        expect(updated?.ssl).toBeNull();
        expect(updated?.settings).toEqual({
          intent: 'read-only-analytics',
          includedTables: ['public.orders'],
        });
        expect(updated?.status).toBe('connected');
        expect(updated?.lastError).toBeNull();
        expect(updated?.updatedAt).toBe(2_000);
        expect(await repo.getDsns(conn.id)).toEqual({
          introspectDsn: 'postgres://ro@h2/d',
          dataDsn: 'postgres://rw@h2/d',
        });

        // An unknown id updates nothing and reports it as such.
        expect(await repo.update('conn_missing', { name: 'x' })).toBeNull();
      });

      it('recordTestResult always leaves an operator-readable failure, even for a bare {ok:false}', async () => {
        // Adapters do not all produce a message — a socket timeout surfaces as
        // a rejected promise with nothing quotable. An `error: null` next to
        // `status: 'error'` renders as an empty health chip, so the repo
        // supplies the fallback rather than the five call sites.
        const repo = connectionsRepo(t.meta, testCrypto);
        const conn = await repo.create(
          { name: 'flaky', engine: 'postgres', introspectDsn: 'postgres://ro@h/d' },
          1_000,
        );

        await repo.recordTestResult(conn.id, { ok: false }, 2_000);
        expect(await repo.findById(conn.id)).toMatchObject({
          status: 'error',
          lastError: 'connection test failed',
          lastErrorHint: null,
          lastLatencyMs: null,
          lastTestedAt: 2_000,
          // Not part of the outcome, so the probed value stands.
          readOnly: false,
        });
      });
    });

    describe('snapshotsRepo', () => {
      it('persists snapshots, keeps exactly one active, and no-ops on equal checksum', async () => {
        const connections = connectionsRepo(t.meta, testCrypto);
        const snapshots = snapshotsRepo(t.meta);
        const conn = await connections.create({
          name: 'prod',
          engine: 'postgres',
          introspectDsn: 'postgres://a@h/d',
        });

        const first = await snapshots.create(
          { connectionId: conn.id, source: 'introspection', schema: MODEL_A, checksum: 'aaa' },
          1_000,
        );
        expect(first.noop).toBe(false);
        expect(first.snapshot.isActive).toBe(true);

        const dupe = await snapshots.create(
          { connectionId: conn.id, source: 'introspection', schema: MODEL_A, checksum: 'aaa' },
          2_000,
        );
        expect(dupe.noop).toBe(true);
        expect(dupe.snapshot.id).toBe(first.snapshot.id);

        const second = await snapshots.create(
          {
            connectionId: conn.id,
            source: 'introspection',
            schema: MODEL_B,
            checksum: 'bbb',
            engineVersion: 'PostgreSQL 16.4',
            stats: { 'public.orders': { rowCount: 42 } },
          },
          3_000,
        );
        expect(second.noop).toBe(false);

        const history = await snapshots.listForConnection(conn.id);
        expect(history.map((s) => s.checksum)).toEqual(['bbb', 'aaa']);
        expect(history.filter((s) => s.isActive).map((s) => s.checksum)).toEqual(['bbb']);

        const latest = await snapshots.latest(conn.id);
        expect(latest?.checksum).toBe('bbb');
        expect(latest?.schema).toEqual(MODEL_B);
        expect(latest?.stats).toEqual({ 'public.orders': { rowCount: 42 } });

        const previous = await snapshots.previous(conn.id, latest!.id);
        expect(previous?.checksum).toBe('aaa');
        expect(await snapshots.previous(conn.id, previous!.id)).toBeNull();

        expect(await snapshots.activate(first.snapshot.id)).toBe(true);
        expect((await snapshots.latest(conn.id))?.checksum).toBe('aaa');
      });

      it('rejects invalid source and empty checksum', async () => {
        const snapshots = snapshotsRepo(t.meta);
        await expect(
          snapshots.create({ connectionId: 'conn_x', source: 'guess' as never, schema: {}, checksum: 'x' }),
        ).rejects.toThrow(MetaValidationError);
        await expect(
          snapshots.create({ connectionId: 'conn_x', source: 'introspection', schema: {}, checksum: '' }),
        ).rejects.toThrow(MetaValidationError);
      });
    });

    describe('overridesRepo', () => {
      it('validates op payloads via the §3.15 vocabulary and stores one row per op', async () => {
        const connections = connectionsRepo(t.meta, testCrypto);
        const overrides = overridesRepo(t.meta);
        const conn = await connections.create({
          name: 'prod',
          engine: 'postgres',
          introspectDsn: 'postgres://a@h/d',
        });

        const label = await overrides.create({
          connectionId: conn.id,
          op: 'column.label',
          tableName: 'public.customers',
          columnName: 'contact_name',
          value: { label: 'Contact' },
        });
        expect(label.op).toBe('column.label');
        expect(label.value).toEqual({ label: 'Contact' });

        await overrides.create({
          connectionId: conn.id,
          op: 'column.pii',
          tableName: 'public.customers',
          columnName: 'email',
          value: { masked: true, kind: 'email' },
        });
        await overrides.create({
          connectionId: conn.id,
          op: 'relation.add',
          tableName: 'public.orders',
          value: {
            fromColumn: 'customer_id',
            toTable: 'public.customers',
            toColumn: 'customer_id',
            cardinality: 'many-to-one',
          },
        });

        const all = await overrides.listForConnection(conn.id);
        expect(all.map((o) => o.op)).toEqual(['column.label', 'column.pii', 'relation.add']);

        // Unknown op / bad payload / wrong column-level shape all refuse to persist.
        await expect(
          overrides.create({ connectionId: conn.id, op: 'table.rename', tableName: 't', value: {} }),
        ).rejects.toThrow(MetaValidationError);
        await expect(
          overrides.create({
            connectionId: conn.id,
            op: 'column.pii',
            tableName: 't',
            columnName: 'c',
            value: { masked: 'yes' },
          }),
        ).rejects.toThrow(MetaValidationError);
        await expect(
          overrides.create({ connectionId: conn.id, op: 'column.label', tableName: 't', value: { label: 'X' } }),
        ).rejects.toThrow(MetaValidationError);
        // Empty labels refuse to persist — the engine's TableModel.label is
        // min(1) and the read path treats '' as an explicit clear, so a stored
        // '' would only exist as a legacy/degenerate row.
        await expect(
          overrides.create({ connectionId: conn.id, op: 'table.label', tableName: 't', value: { label: '' } }),
        ).rejects.toThrow(MetaValidationError);
        await expect(
          overrides.create({
            connectionId: conn.id,
            op: 'column.label',
            tableName: 't',
            columnName: 'c',
            value: { label: '' },
          }),
        ).rejects.toThrow(MetaValidationError);
        await expect(
          overrides.create({
            connectionId: conn.id,
            op: 'table.exclude',
            tableName: 't',
            columnName: 'c',
            value: { excluded: true },
          }),
        ).rejects.toThrow(MetaValidationError);
        expect((await overrides.listForConnection(conn.id)).length).toBe(3);
      });

      it('replaceForConnection is transactional PUT; setStatus toggles without deleting', async () => {
        const connections = connectionsRepo(t.meta, testCrypto);
        const overrides = overridesRepo(t.meta);
        const conn = await connections.create({
          name: 'prod',
          engine: 'postgres',
          introspectDsn: 'postgres://a@h/d',
        });
        const seeded = await overrides.create({
          connectionId: conn.id,
          op: 'table.label',
          tableName: 'public.customers',
          value: { label: 'Customers' },
        });

        // Invalid batch → nothing changes.
        await expect(
          overrides.replaceForConnection(conn.id, [
            { op: 'table.exclude', tableName: 'public.orders', value: { excluded: true } },
            { op: 'column.hidden', tableName: 'public.orders', columnName: 'x', value: { hidden: 'nope' } },
          ]),
        ).rejects.toThrow(MetaValidationError);
        expect((await overrides.listForConnection(conn.id)).map((o) => o.id)).toEqual([seeded.id]);

        const replaced = await overrides.replaceForConnection(conn.id, [
          { op: 'table.exclude', tableName: 'public.orders', value: { excluded: true } },
          { op: 'column.hidden', tableName: 'public.orders', columnName: 'internal', value: { hidden: true } },
        ]);
        expect(replaced.length).toBe(2);
        const current = await overrides.listForConnection(conn.id);
        expect(current.map((o) => o.op).sort()).toEqual(['column.hidden', 'table.exclude']);

        const target = current[0]!;
        expect(await overrides.setStatus(target.id, 'disabled', 9_000)).toBe(true);
        expect((await overrides.listForConnection(conn.id, { status: 'active' })).length).toBe(1);
        expect((await overrides.listForConnection(conn.id)).length).toBe(2);
        expect(await overrides.delete(target.id)).toBe(true);
        expect(await overrides.findById(target.id)).toBeNull();
      });

      it('cascades with the parent connection', async () => {
        const connections = connectionsRepo(t.meta, testCrypto);
        const overrides = overridesRepo(t.meta);
        const snapshots = snapshotsRepo(t.meta);
        const conn = await connections.create({
          name: 'prod',
          engine: 'postgres',
          introspectDsn: 'postgres://a@h/d',
        });
        await overrides.create({
          connectionId: conn.id,
          op: 'table.exclude',
          tableName: 'public.logs',
          value: { excluded: true },
        });
        await snapshots.create({ connectionId: conn.id, source: 'introspection', schema: MODEL_A, checksum: 'a' });

        await connections.delete(conn.id);
        expect(await overrides.listForConnection(conn.id)).toEqual([]);
        expect(await snapshots.listForConnection(conn.id)).toEqual([]);
      });
    });
  });
}
