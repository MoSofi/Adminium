// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0047 (`mysql_longtext`) on every available dialect.
 *
 * MySQL's `text` holds 65,535 bytes, and `c.text` was `text` there, so an
 * enrichment prompt, a model's reply, a public endpoint's definition or an
 * app's outbox longer than that was refused ("Data too long for column") on
 * the engine a real install is likely to use, while SQLite and PostgreSQL
 * stored it. The round trip below is the test that failed before; the upgrade
 * test builds a store the way the previous build did (`c.text` = `text`) and
 * proves 0047 converts every column, keeping NULL / NOT NULL, default and
 * character set, and the rows already in it.
 */
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  appOutboxesRepo,
  applyMigrations,
  connectionsRepo,
  firstRun,
  llmRunsRepo,
  manifestsRepo,
  migrationChecksum,
  publicEndpointsRepo,
  snapshotsRepo,
  type DsnCrypto,
  type MetaDb,
  type MetaMigration,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const crypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

const T0 = 1_750_000_000_000;
/** One byte past MySQL `text`, with room. */
const BIG = 'x'.repeat(100_000);
/** 30,000 characters, under 65,535, but 90,000 bytes in utf8mb4: the limit counts bytes. */
const WIDE = '漢'.repeat(30_000);
const PRE_0047 = ALL_MIGRATIONS.filter((m) => m.name < '0047_mysql_longtext');

interface ColumnFacts {
  table: string;
  column: string;
  type: string;
  nullable: string;
  default: string | null;
  charset: string | null;
  collation: string | null;
}

/** Every text-family column of the store, as MySQL describes it. */
async function textColumns(meta: MetaDb): Promise<ColumnFacts[]> {
  const rows = await sql<ColumnFacts>`
    select table_name as \`table\`, column_name as \`column\`, data_type as type, is_nullable as nullable,
           column_default as \`default\`, character_set_name as charset, collation_name as collation
      from information_schema.columns
     where table_schema = database() and data_type in ('tinytext', 'text', 'mediumtext', 'longtext')
     order by table_name, column_name`.execute(meta.db);
  return rows.rows;
}

/** Column types as the dialect's own introspection reports them, for the no-op dialects. */
async function allColumnTypes(meta: MetaDb): Promise<string[]> {
  const tables = await meta.db.introspection.getTables();
  return tables.flatMap((t) => t.columns.map((c) => `${t.name}.${c.name}:${c.dataType}:${String(c.isNullable)}`)).sort();
}

/**
 * The migrations as the previous build ran them: the same sources, with
 * `c.text` = `text` on every dialect. The ledger then gets the checksums of
 * the real sources, which is what that build wrote (the migration files did
 * not change, only the helper they are given).
 */
async function migrateLikeThePreviousBuild(meta: MetaDb): Promise<void> {
  const previous: MetaMigration[] = PRE_0047.map((m) => ({ name: m.name, up: (db, c) => m.up(db, { ...c, text: 'text' }) }));
  await applyMigrations(meta.db, { dialect: meta.dialect, migrations: previous });
  for (const m of PRE_0047) {
    await meta.db.updateTable('adminium_migrations').set({ checksum: migrationChecksum(m) }).where('name', '=', m.name).execute();
  }
}

async function sourceOf(meta: MetaDb): Promise<{ connectionId: string; snapshotId: string }> {
  const connection = await connectionsRepo(meta, crypto).create({ name: 'shop', engine: 'postgres', introspectDsn: 'postgres://ro@localhost/shop' });
  const snapshot = await snapshotsRepo(meta).create({
    connectionId: connection.id,
    source: 'introspection',
    schema: { irVersion: 1, dialect: 'postgres', name: 'shop', tables: [] },
    checksum: 'sha-shop-1',
  });
  return { connectionId: connection.id, snapshotId: snapshot.snapshot.id };
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0047_mysql_longtext [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('stores an enrichment prompt and reply, an endpoint definition and an outbox over 64 KB', async () => {
      const m = t.meta;
      await firstRun(m);
      const { connectionId, snapshotId } = await sourceOf(m);

      const runs = llmRunsRepo(m);
      const run = await runs.create({ connectionId, snapshotId, mode: 'byo', promptVersion: 'v1', promptHash: 'a'.repeat(64), promptText: BIG });
      await runs.recordResponse(run.id, { status: 'awaiting_response', validationStatus: 'invalid', responseRaw: BIG });
      const wide = await runs.create({ connectionId, snapshotId, mode: 'byo', promptVersion: 'v1', promptHash: 'b'.repeat(64), promptText: WIDE });
      expect((await runs.findById(run.id))?.promptText).toBe(BIG);
      expect((await runs.findById(run.id))?.responseRaw).toBe(BIG);
      expect((await runs.findById(wide.id))?.promptText).toBe(WIDE);

      const definition = JSON.stringify({ path: '/notes', select: ['id'], defaults: { note: BIG } });
      const endpoint = await publicEndpointsRepo(m).create({ connectionId, ref: 'notes', origin: 'custom', definition }, T0);
      expect((await publicEndpointsRepo(m).findById(endpoint.id))?.definition).toBe(definition);

      const install = await manifestsRepo(m, crypto).install({ manifestKey: 'clinic', version: '0.2.0', kind: 'app', source: 'file', document: {}, connectionId });
      const outbox = JSON.stringify({ table: 'outbox', kinds: { reminder: WIDE } });
      await appOutboxesRepo(m).put({ appKey: 'clinic', manifestId: install.row.id, connectionId, definition: outbox }, T0);
      expect((await appOutboxesRepo(m).findByApp('clinic'))?.definition).toBe(outbox);

      if (m.dialect === 'mysql') {
        const columns = await textColumns(m);
        expect(columns).toHaveLength(34);
        expect(columns.filter((c) => c.type !== 'longtext')).toEqual([]);
      }
    });

    it('converts every text column of a store the previous build made, and keeps what else it had', async () => {
      const m = t.meta;
      expect(PRE_0047.length).toBe(46);
      await migrateLikeThePreviousBuild(m);
      const { connectionId } = await sourceOf(m);
      // A row written before the upgrade, as long as the old column allowed.
      const kept = JSON.stringify({ path: '/kept', pad: 'k'.repeat(60_000) });
      const endpoint = await publicEndpointsRepo(m).create({ connectionId, ref: 'kept', origin: 'custom', definition: kept }, T0);

      if (m.dialect !== 'mysql') {
        const before = await allColumnTypes(m);
        expect((await applyMigrations(m.db, { dialect: m.dialect })).applied).toEqual(['0047_mysql_longtext', '0048_public_key_peak', '0049_project_apps', '0050_catalog_default', '0051_automation_ownership', '0052_assistant_turn_page', '0053_assistant_use', '0054_assistant_abilities']);
        // Nothing of 0047's here; 0048 adds a key's peak, two columns of its own, and 0049 a table of its own.
        expect(
          (await allColumnTypes(m)).filter((column) => !/^adminium_public_keys\.peak_(reads|writes):|^adminium_project_apps\.|^adminium_automations\.(managed_by|template_key|content_hash):|^adminium_assistant_turns\.(context|host|draft|answer):|^adminium_assistant_sessions\.kind:|^adminium_assistant_use\./.test(column)),
        ).toEqual(before);
      } else {
        const before = await textColumns(m);
        expect(before).toHaveLength(34);
        expect(before.filter((c) => c.type !== 'text')).toEqual([]);
        expect(before.filter((c) => c.nullable === 'NO').map((c) => `${c.table}.${c.column}`)).toEqual([
          'adminium_add_on_credentials.payload',
          'adminium_app_outboxes.definition',
          'adminium_public_endpoints.definition',
          'adminium_public_keys.token_encrypted',
          'adminium_translations.value',
          'adminium_webhooks.secret_encrypted',
        ]);
        // What the previous build refused.
        await expect(
          publicEndpointsRepo(m).create({ connectionId, ref: 'refused', origin: 'custom', definition: BIG }, T0),
        ).rejects.toThrow(/Data too long/);

        expect((await applyMigrations(m.db, { dialect: m.dialect })).applied).toEqual(['0047_mysql_longtext', '0048_public_key_peak', '0049_project_apps', '0050_catalog_default', '0051_automation_ownership', '0052_assistant_turn_page', '0053_assistant_use', '0054_assistant_abilities']);
        const after = await textColumns(m);
        expect(after).toEqual(before.map((c) => ({ ...c, type: 'longtext' })));
      }

      expect((await publicEndpointsRepo(m).findById(endpoint.id))?.definition).toBe(kept);
      const big = await publicEndpointsRepo(m).create({ connectionId, ref: 'big', origin: 'custom', definition: BIG }, T0);
      expect((await publicEndpointsRepo(m).findById(big.id))?.definition).toBe(BIG);
      // The ledger holds: a second run applies nothing and reports no drift.
      expect((await applyMigrations(m.db, { dialect: m.dialect })).applied).toEqual([]);
    });
  });
}
