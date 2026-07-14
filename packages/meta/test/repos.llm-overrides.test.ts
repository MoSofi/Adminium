/**
 * llmOverridesRepo — the LLM slice of adminium_schema_overrides (06-llm-assist.md §8.3).
 *
 * Locks the write-layer contract the apply-EXECUTOR relies on: an idempotent
 * upsert keyed on (connection, op, table, column) that supersedes in place, a
 * before-image + restore/delete for undo, and strict isolation from the user
 * remap vocabulary (a `origin: 'user'` row is never read or clobbered).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  connectionsRepo,
  firstRun,
  llmOverrideOp,
  llmOverridesRepo,
  overridesRepo,
  type DsnCrypto,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`llmOverridesRepo [${dialect.name}]`, () => {
    let t: TestDb;
    let connectionId: string;

    beforeEach(async () => {
      t = await dialect.make();
      await firstRun(t.meta);
      const connection = await connectionsRepo(t.meta, testCrypto).create({
        name: 'shop',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/shop',
      });
      connectionId = connection.id;
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('inserts a namespaced llm.* override row', async () => {
      const repo = llmOverridesRepo(t.meta);
      const { override, action, before } = await repo.upsert({
        connectionId,
        field: 'label',
        tableName: 'public.orders',
        value: { label: { en_US: 'Orders' } },
        confidence: 0.95,
        llmRunId: 'run_a',
      });
      expect(action).toBe('inserted');
      expect(before).toBeNull();
      expect(override.field).toBe('label');
      expect(override.columnName).toBeNull();
      expect(override.value).toEqual({ label: { en_US: 'Orders' } });
      expect(override.confidence).toBe(0.95);

      // Persisted under the namespaced op so it never collides with the user vocabulary.
      const raw = await t.meta.db
        .selectFrom('adminium_schema_overrides')
        .selectAll()
        .where('id', '=', override.id)
        .executeTakeFirstOrThrow();
      expect(raw.op).toBe(llmOverrideOp('label'));
      expect(raw.origin).toBe('llm');
    });

    it('upsert is idempotent and supersedes the llm_run_id in place', async () => {
      const repo = llmOverridesRepo(t.meta);
      const key = { connectionId, field: 'label', tableName: 'public.orders', value: { label: { en_US: 'Orders' } } } as const;

      const first = await repo.upsert({ ...key, llmRunId: 'run_a' });
      const second = await repo.upsert(
        { ...key, value: { label: { en_US: 'Sales orders' } }, llmRunId: 'run_b' },
      );

      expect(second.action).toBe('updated');
      expect(second.before?.value).toEqual({ label: { en_US: 'Orders' } });
      expect(second.before?.llmRunId).toBe('run_a');
      expect(second.override.id).toBe(first.override.id); // same row, no duplicate

      const rows = await repo.listForConnection(connectionId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.value).toEqual({ label: { en_US: 'Sales orders' } });
      expect(rows[0]?.llmRunId).toBe('run_b');
    });

    it('table- and column-scoped rows for the same field are distinct targets', async () => {
      const repo = llmOverridesRepo(t.meta);
      await repo.upsert({ connectionId, field: 'label', tableName: 'public.orders', value: { label: { en_US: 'Orders' } } });
      await repo.upsert({
        connectionId,
        field: 'label',
        tableName: 'public.orders',
        columnName: 'status',
        value: { label: { en_US: 'Status' } },
      });
      expect(await repo.listForConnection(connectionId)).toHaveLength(2);
    });

    it('restore + deleteById revert a superseded / inserted row (undo)', async () => {
      const repo = llmOverridesRepo(t.meta);
      const first = await repo.upsert({ connectionId, field: 'key', tableName: 'public.orders', value: { displayColumn: 'order_number', naturalKey: ['order_number'] }, llmRunId: 'run_a' });
      const second = await repo.upsert({ connectionId, field: 'key', tableName: 'public.orders', value: { displayColumn: 'id', naturalKey: null }, llmRunId: 'run_b' });

      await repo.restore(second.before!);
      expect((await repo.listForConnection(connectionId))[0]?.value).toEqual({
        displayColumn: 'order_number',
        naturalKey: ['order_number'],
      });

      await repo.deleteById(first.override.id);
      expect(await repo.listForConnection(connectionId)).toEqual([]);
    });

    it('stores an explicit null value (a PII rejection clear)', async () => {
      const repo = llmOverridesRepo(t.meta);
      const { override } = await repo.upsert({ connectionId, field: 'pii', tableName: 'public.users', columnName: 'last_ip', value: null });
      expect(override.value).toBeNull();
      expect((await repo.listForConnection(connectionId))[0]?.value).toBeNull();
    });

    it('never reads a user override — the two namespaces are disjoint', async () => {
      await overridesRepo(t.meta).create({
        connectionId,
        op: 'table.label',
        tableName: 'public.orders',
        value: { label: 'Human orders' },
        origin: 'user',
      });
      const repo = llmOverridesRepo(t.meta);
      await repo.upsert({ connectionId, field: 'label', tableName: 'public.orders', value: { label: { en_US: 'Orders' } } });

      // The llm view sees only its own row; the user row is untouched.
      const llmRows = await repo.listForConnection(connectionId);
      expect(llmRows).toHaveLength(1);
      expect(llmRows[0]?.value).toEqual({ label: { en_US: 'Orders' } });

      const allRows = await overridesRepo(t.meta).listForConnection(connectionId);
      const userRow = allRows.find((o) => o.origin === 'user');
      expect(userRow?.value).toEqual({ label: 'Human orders' });
    });
  });
}
