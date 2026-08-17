// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  connectionsRepo,
  firstRun,
  llmRunsRepo,
  snapshotsRepo,
  usersRepo,
  type DsnCrypto,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

/** Columns 0007_llm_runs adds on top of 0006 (§7.4). */
const ADDED_COLUMNS = [
  'status',
  'sections',
  'locales',
  'sampling',
  'chunks_total',
  'chunks_received',
  'prompt_text',
  'review',
] as const;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`llmRunsRepo + 0007 migration [${dialect.name}]`, () => {
    let t: TestDb;
    let connectionId: string;
    let snapshotId: string;
    let userId: string;

    beforeEach(async () => {
      t = await dialect.make();
      await firstRun(t.meta);
      const connection = await connectionsRepo(t.meta, testCrypto).create({
        name: 'shop',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/shop',
      });
      connectionId = connection.id;
      const snapshot = await snapshotsRepo(t.meta).create({
        connectionId,
        source: 'introspection',
        schema: { irVersion: 1, dialect: 'postgres', name: 'shop', tables: [] },
        checksum: 'sha-shop-1',
      });
      snapshotId = snapshot.snapshot.id;
      userId = (await usersRepo(t.meta).create({ email: 'ava@adminium.test', name: 'Ava' })).id;
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('0007 adds every §7.4 column to adminium_llm_runs', async () => {
      const tables = await t.meta.db.introspection.getTables();
      const runs = tables.find((table) => table.name === 'adminium_llm_runs');
      expect(runs).toBeDefined();
      const columns = new Set(runs?.columns.map((c) => c.name));
      for (const name of ADDED_COLUMNS) {
        expect(columns, `missing column ${name}`).toContain(name);
      }
    });

    it('creates a BYO draft with provider/model NULL and round-trips builder inputs (§9)', async () => {
      const repo = llmRunsRepo(t.meta);
      const run = await repo.create({
        connectionId,
        snapshotId,
        mode: 'byo',
        promptVersion: 'adminium.prompt/v1',
        promptHash: 'a'.repeat(64),
        promptText: '=== SYSTEM ===\n…\n\n=== USER ===\n…',
        sections: ['labels', 'enums'],
        locales: ['en_US', 'de_DE'],
        sampling: null,
        createdBy: userId,
      });

      expect(run.status).toBe('draft');
      expect(run.validationStatus).toBe('pending');
      expect(run.provider).toBeNull();
      expect(run.model).toBeNull();
      expect(run.chunksTotal).toBe(1);
      expect(run.chunksReceived).toBe(0);

      const fetched = await repo.findById(run.id);
      expect(fetched?.sections).toEqual(['labels', 'enums']);
      expect(fetched?.locales).toEqual(['en_US', 'de_DE']);
      expect(fetched?.sampling).toBeNull();
      expect(fetched?.promptText).toContain('=== USER ===');
      expect(fetched?.responseJson).toBeNull();
      expect(fetched?.review).toBeNull();
    });

    it('records a provider run with sampling opt-in and tokens', async () => {
      const repo = llmRunsRepo(t.meta);
      const run = await repo.create({
        connectionId,
        snapshotId,
        mode: 'provider',
        provider: 'anthropic',
        model: 'claude-x',
        promptVersion: 'adminium.prompt/v1',
        promptHash: 'b'.repeat(64),
        sampling: { maxValuesPerColumn: 20 },
        locales: ['en_US'],
      });
      const fetched = await repo.findById(run.id);
      expect(fetched?.provider).toBe('anthropic');
      expect(fetched?.model).toBe('claude-x');
      expect(fetched?.sampling).toEqual({ maxValuesPerColumn: 20 });
    });

    it('lists runs for a connection, newest first', async () => {
      const repo = llmRunsRepo(t.meta);
      const first = await repo.create({
        connectionId,
        snapshotId,
        mode: 'byo',
        promptVersion: 'adminium.prompt/v1',
        promptHash: '1'.repeat(64),
      });
      const second = await repo.create({
        connectionId,
        snapshotId,
        mode: 'byo',
        promptVersion: 'adminium.prompt/v1',
        promptHash: '2'.repeat(64),
      });
      const list = await repo.listForConnection(connectionId);
      expect(list.map((r) => r.id)).toEqual([second.id, first.id]);
    });

    it('updateStatus honours the optimistic `expected` guard', async () => {
      const repo = llmRunsRepo(t.meta);
      const run = await repo.create({
        connectionId,
        snapshotId,
        mode: 'byo',
        promptVersion: 'adminium.prompt/v1',
        promptHash: '3'.repeat(64),
      });
      // Wrong expectation → no-op.
      expect(await repo.updateStatus(run.id, 'validated', { expected: 'running' })).toBe(false);
      expect((await repo.findById(run.id))?.status).toBe('draft');
      // Correct expectation → lands.
      expect(await repo.updateStatus(run.id, 'awaiting_response', { expected: 'draft' })).toBe(true);
      expect((await repo.findById(run.id))?.status).toBe('awaiting_response');
    });

    it('recordResponse persists the validated response + errors and advances status', async () => {
      const repo = llmRunsRepo(t.meta);
      const run = await repo.create({
        connectionId,
        snapshotId,
        mode: 'byo',
        promptVersion: 'adminium.prompt/v1',
        promptHash: '4'.repeat(64),
      });
      const parsed = { schema_version: 'adminium.llm/v1', tables: [] };
      await repo.recordResponse(run.id, {
        status: 'validated',
        validationStatus: 'partial',
        responseRaw: '{"schema_version":"adminium.llm/v1"}',
        responseJson: parsed,
        validationErrors: [{ code: 'LLM_UNKNOWN_COLUMN', path: 'tables[0].columns[0]' }],
        chunksReceived: 1,
      });
      const fetched = await repo.findById(run.id);
      expect(fetched?.status).toBe('validated');
      expect(fetched?.validationStatus).toBe('partial');
      expect(fetched?.responseJson).toEqual(parsed);
      expect(fetched?.chunksReceived).toBe(1);
      expect(Array.isArray(fetched?.validationErrors)).toBe(true);
    });

    it('recordReview + markApplied stamp the terminal apply', async () => {
      const repo = llmRunsRepo(t.meta);
      const run = await repo.create({
        connectionId,
        snapshotId,
        mode: 'byo',
        promptVersion: 'adminium.prompt/v1',
        promptHash: '5'.repeat(64),
      });
      await repo.recordReview(run.id, { accepted: ['label:public.orders'], rejected: [] });
      expect((await repo.findById(run.id))?.review).toEqual({
        accepted: ['label:public.orders'],
        rejected: [],
      });

      const at = 1_700_000_000_000;
      expect(
        await repo.markApplied(run.id, { appliedBy: userId, status: 'partially_applied' }, at),
      ).toBe(true);
      const applied = await repo.findById(run.id);
      expect(applied?.status).toBe('partially_applied');
      expect(applied?.appliedBy).toBe(userId);
      expect(applied?.appliedAt).toBe(at);
    });

    it('rejects an invalid mode / status / review payload', async () => {
      const repo = llmRunsRepo(t.meta);
      await expect(
        repo.create({
          connectionId,
          snapshotId,
          // @ts-expect-error — invalid mode
          mode: 'nope',
          promptVersion: 'adminium.prompt/v1',
          promptHash: '6'.repeat(64),
        }),
      ).rejects.toThrow(/mode/);

      const run = await repo.create({
        connectionId,
        snapshotId,
        mode: 'byo',
        promptVersion: 'adminium.prompt/v1',
        promptHash: '7'.repeat(64),
      });
      await expect(
        // @ts-expect-error — review must have accepted/rejected string arrays
        repo.recordReview(run.id, { accepted: 'label:x' }),
      ).rejects.toThrow(/review/);
    });
  });
}
