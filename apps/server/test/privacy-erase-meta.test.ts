// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT ADMINIUM KEEPS OF AN ERASED PERSON, EMPTIED, on SQLite, Postgres and
 * MySQL meta stores (Postgres and MySQL hand JSON back parsed, and cast it
 * to text their own way):
 *
 *  - the audit entries about her rows lose the erased columns wherever their
 *    changes hold them (nested too); her own public write loses its network
 *    address and browser; a staff member's entry keeps theirs; another row's
 *    entries, and another table's with the same key, are untouched;
 *  - a removed row of hers, and a removed copy that linked to her, lose the
 *    same columns, and the audit entries about that removed copy too;
 *  - any text still holding her address is nulled, never one holding
 *    another address that merely contains hers;
 *  - her campaign sends keep their state with the address and name emptied,
 *    and one still waiting is skipped as stopped;
 *  - the files on her rows are found (by the table's id or its name), and
 *    deleted bytes first.
 *
 * And the rule each erased field follows (`erase-values.ts`).
 */
import { auditRepo, connectionsRepo, emailRunsRepo, emailSendsRepo, emailTemplatesRepo, filesRepo, removedRowsRepo, type MetaDb } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import type { FileStore } from '../src/files/store.js';
import { blankCampaignSends, campaignSendIds, nullAddress, nullColumns, purgeRowFiles, rowFileIds, scrubAuditImages, scrubRemovedRows, sweepAddress } from '../src/privacy/erase-meta.js';
import { alreadyBlank, blankValue, type ColumnFacts } from '../src/privacy/erase-values.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const MARTA = 'marta.kovac@cobaltlegal.example';
const CONTACTS = 'public.crm_contacts';
const VISITS = 'public.crm_visits';
const NAME = 'Erased person';

const facts = (more: Partial<ColumnFacts> = {}): ColumnFacts => ({ nullable: false, logicalType: 'text', unique: false, maxLength: null, generated: false, ...more });

describe('what an erased field becomes', () => {
  it('is NULL wherever the column takes it, whatever it is', () => {
    expect(blankValue(facts({ nullable: true }), 'name', 'sqlite', NAME)).toEqual({ value: null });
    expect(blankValue(facts({ nullable: true, unique: true }), 'email', 'mysql', NAME)).toEqual({ value: null });
    expect(blankValue(facts({ nullable: true, logicalType: 'int' }), 'other', 'postgres', NAME)).toEqual({ value: null });
  });

  it('reads "no" for a yes/no that may not be empty, as the database keeps one', () => {
    expect(blankValue(facts({ logicalType: 'boolean' }), 'other', 'postgres', NAME)).toEqual({ value: false });
    expect(blankValue(facts({ logicalType: 'boolean' }), 'other', 'mysql', NAME)).toEqual({ value: 0 });
    expect(blankValue(facts({ logicalType: 'boolean' }), 'other', 'sqlite', NAME)).toEqual({ value: 0 });
  });

  it('gives a NOT NULL name "Erased person", other text nothing, and a unique column a value of its own', () => {
    expect(blankValue(facts(), 'name', 'sqlite', NAME)).toEqual({ value: NAME });
    expect(blankValue(facts({ maxLength: 6 }), 'name', 'sqlite', NAME)).toEqual({ value: 'Erased' });
    expect(blankValue(facts(), 'other', 'sqlite', NAME)).toEqual({ value: '' });
    const a = blankValue(facts({ unique: true }), 'email', 'mysql', NAME) as { value: string };
    const b = blankValue(facts({ unique: true }), 'email', 'mysql', NAME) as { value: string };
    expect(a.value).toMatch(/^erased-[0-9a-f]{12}@erased\.invalid$/);
    expect(a.value).not.toBe(b.value);
    expect((blankValue(facts({ unique: true }), 'name', 'mysql', NAME) as { value: string }).value).toMatch(/^erased-[0-9a-f]{12}$/);
    // Never `''` on a unique column, even a name.
    expect(blankValue(facts({ unique: true }), 'name', 'sqlite', NAME)).not.toEqual({ value: '' });
  });

  it('leaves what cannot be emptied, and never writes a column the database works out', () => {
    expect(blankValue(facts({ logicalType: 'date' }), 'other', 'sqlite', NAME)).toEqual({ left: true });
    expect(blankValue(facts({ logicalType: 'enum' }), 'other', 'sqlite', NAME)).toEqual({ left: true });
    expect(blankValue(facts({ nullable: true, generated: true }), 'name', 'sqlite', NAME)).toEqual({ left: true });
  });

  it('knows a field already empty', () => {
    expect(alreadyBlank(null, facts(), 'name', NAME)).toBe(true);
    expect(alreadyBlank(NAME, facts(), 'name', NAME)).toBe(true);
    expect(alreadyBlank('Marta', facts(), 'name', NAME)).toBe(false);
    expect(alreadyBlank('erased-0a0b0c0d0e0f@erased.invalid', facts({ unique: true }), 'email', NAME)).toBe(true);
    expect(alreadyBlank(MARTA, facts({ unique: true }), 'email', NAME)).toBe(false);
    expect(alreadyBlank(0, facts({ logicalType: 'boolean' }), 'other', NAME)).toBe(true);
    expect(alreadyBlank(true, facts({ logicalType: 'boolean' }), 'other', NAME)).toBe(false);
  });

  it('nulls named columns anywhere in an entry, and texts holding the address whole', () => {
    const changes = { before: { name: 'Marta', job: 'x' }, after: { name: 'M', nested: [{ name: 'Marta' }] }, values: { other: 1 } };
    expect(nullColumns(changes, new Set(['name']))).toBe(true);
    expect(changes).toEqual({ before: { name: null, job: 'x' }, after: { name: null, nested: [{ name: null }] }, values: { other: 1 } });
    expect(nullColumns({ name: null }, new Set(['name']))).toBe(false);
    expect(nullAddress({ a: `to ${MARTA}.`, b: `x${MARTA}`, [MARTA]: 1, c: [MARTA.toUpperCase()] }, MARTA)).toEqual({ value: { a: null, b: `x${MARTA}`, c: [null] }, changed: true });
  });
});

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`what Adminium keeps of an erased person, emptied [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let conn = '';
    let other = '';
    const ids: Record<string, string> = {};
    const entity = (connectionId: string, table: string, key: number) => ({ connectionId, table, pk: { id: key }, label: String(key) });
    const changesOf = async (id: string) => {
      const row = await meta.db.selectFrom('adminium_audit_log').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      return { ...row, changes: typeof row.changes === 'string' ? (JSON.parse(row.changes) as unknown) : row.changes };
    };
    const imageOf = async (id: string) => {
      const row = await meta.db.selectFrom('adminium_removed_rows').select('image').where('id', '=', id).executeTakeFirstOrThrow();
      return typeof row.image === 'string' ? (JSON.parse(row.image) as unknown) : row.image;
    };

    beforeAll(async () => {
      handle = await engine.make();
      meta = handle.meta;
      const connections = connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET));
      conn = (await connections.create({ name: 'crm', engine: 'postgres', introspectDsn: 'postgres://ro:s@db/crm' })).id;
      other = (await connections.create({ name: 'other', engine: 'postgres', introspectDsn: 'postgres://ro:s@db/other' })).id;
      const audit = auditRepo(meta);
      const image = (name: string) => ({ id: 1, name, email: null, _masked: ['email'] });
      ids['staff'] = (await audit.append({ actorKind: 'user', actorId: 'usr_1', actorLabel: 'Dana', category: 'data', action: 'record.update', connectionId: conn, entity: entity(conn, CONTACTS, 1), changes: { before: image('Marta Kovac'), after: image('Marta K.') }, ip: '10.0.0.5', userAgent: 'Desk' })).id;
      ids['public'] = (await audit.append({ actorKind: 'api-key', actorLabel: 'public:key_1', category: 'data', action: 'public.record.update', connectionId: conn, entity: entity(conn, CONTACTS, 1), changes: { after: { name: 'Marta', claimed: true } }, ip: '81.2.69.160', userAgent: 'Firefox' })).id;
      ids['ben'] = (await audit.append({ actorKind: 'user', actorId: 'usr_1', actorLabel: 'Dana', category: 'data', action: 'record.update', connectionId: conn, entity: entity(conn, CONTACTS, 2), changes: { before: image('Ben Other'), after: image('Ben O.') } })).id;
      // The same key on another database, and on another table: not hers.
      ids['elsewhere'] = (await audit.append({ actorKind: 'user', actorLabel: 'Dana', category: 'data', action: 'record.update', connectionId: other, entity: entity(other, CONTACTS, 1), changes: { after: image('Ola') } })).id;
      ids['deal'] = (await audit.append({ actorKind: 'user', actorLabel: 'Dana', category: 'data', action: 'record.update', connectionId: conn, entity: entity(conn, 'public.crm_deals', 1), changes: { after: { id: 1, name: 'Desks' } } })).id;
      ids['note'] = (await audit.append({ actorKind: 'user', actorLabel: 'Dana', category: 'settings', action: 'note.add', changes: { after: { note: `Wrote to ${MARTA.toUpperCase()}.`, keep: 1 } } })).id;
      ids['near'] = (await audit.append({ actorKind: 'user', actorLabel: 'Dana', category: 'settings', action: 'note.add', changes: { after: { note: `Wrote to x${MARTA}.` } } })).id;
      ids['visit-audit'] = (await audit.append({ actorKind: 'user', actorLabel: 'Dana', category: 'data', action: 'record.delete', connectionId: conn, entity: entity(conn, VISITS, 9), changes: { before: { id: 9, contact_id: 1, visitor_name: 'Marta Kovac' }, after: null } })).id;

      const removed = removedRowsRepo(meta);
      await removed.add({ connectionId: conn, entityTable: CONTACTS, entityId: '1', pk: { id: 1 }, links: [{ via: 'company_id', parentTable: 'public.crm_companies', parentValue: '1' }], removedAt: 1, actorKind: 'user', actorId: null, actorLabel: 'Dana', reason: null, image: { id: 1, name: 'Marta Kovac', company_id: 1 } });
      await removed.add({ connectionId: conn, entityTable: VISITS, entityId: '9', pk: { id: 9 }, links: [{ via: 'contact_id', parentTable: CONTACTS, parentValue: '1' }], removedAt: 1, actorKind: 'user', actorId: null, actorLabel: 'Dana', reason: null, image: { id: 9, contact_id: 1, visitor_name: 'Marta Kovac', day: 'Mon' } });
      await removed.add({ connectionId: conn, entityTable: VISITS, entityId: '10', pk: { id: 10 }, links: [{ via: 'contact_id', parentTable: CONTACTS, parentValue: '2' }], removedAt: 1, actorKind: 'user', actorId: null, actorLabel: 'Dana', reason: null, image: { id: 10, contact_id: 2, visitor_name: 'Ben Other', note: `cc ${MARTA}` } });
      const rows = await meta.db.selectFrom('adminium_removed_rows').select(['id', 'entityTable', 'entityId']).execute();
      for (const row of rows) ids[`rm-${row.entityTable}-${row.entityId}`] = row.id;

      const template = await emailTemplatesRepo(meta).create({ kind: 'campaign', key: 'july', locale: 'en_US', name: 'July', subject: 'July', blocks: [] });
      const run = await emailRunsRepo(meta).create({ templateId: template.id, audience: { kind: 'users' }, scheduledAt: 1 });
      ids['run'] = run.id;
      await emailSendsRepo(meta).write(
        run.id,
        [
          { address: ` ${MARTA.toUpperCase()}`, name: 'Marta Kovac' },
          { address: 'marta.old@cobaltlegal.example', name: 'Marta Kovac', connectionId: conn, personTable: 'crm_contacts', personKey: '1' },
          { address: `x${MARTA}`, name: 'Xavier' },
          { address: 'ben@other.example', name: 'Ben', connectionId: conn, personTable: CONTACTS, personKey: '2' },
        ],
        1,
      );
      await meta.db.updateTable('adminium_email_sends').set({ state: 'sent' }).where('runId', '=', run.id).where('seq', '=', 1).execute();

      const file = (table: string, key: number, name: string) => filesRepo(meta).create({ filename: name, mime: 'application/pdf', sizeBytes: 1, sha256: 'a'.repeat(64), kind: 'upload', uploadedBy: null, entity: entity(conn, table, key) });
      ids['file-hers'] = (await file(CONTACTS, 1, 'hers.pdf')).id;
      ids['file-ben'] = (await file(CONTACTS, 2, 'ben.pdf')).id;
      ids['file-deal'] = (await file('public.crm_deals', 1, 'deal.pdf')).id;
    }, 120_000);
    afterAll(async () => {
      await handle?.destroy();
    });

    it('empties the images of her rows and her removed copies, and nothing of anybody else', async () => {
      const target = { connectionId: conn, table: CONTACTS, keys: ['1'], columns: new Map([['1', ['name', 'email']]]), own: true };
      const removed = await scrubRemovedRows(meta, [target], [{ connectionId: conn, copyTable: VISITS, via: 'contact_id', columns: ['visitor_name'], parentTable: CONTACTS, parentKeys: ['1'] }]);
      expect(removed.changed).toBe(2);
      expect(removed.copies).toEqual([{ connectionId: conn, table: VISITS, keys: ['9'], columns: new Map([['9', ['visitor_name']]]), own: false }]);
      expect(await scrubAuditImages(meta, [target, ...removed.copies])).toBe(3);

      expect((await changesOf(ids['staff']!)).changes).toEqual({ before: { id: 1, name: null, email: null, _masked: ['email'] }, after: { id: 1, name: null, email: null, _masked: ['email'] } });
      // A staff member's entry keeps where they wrote from; her own public write loses it.
      expect(await changesOf(ids['staff']!)).toMatchObject({ ip: '10.0.0.5', userAgent: 'Desk' });
      expect(await changesOf(ids['public']!)).toMatchObject({ ip: null, userAgent: null, changes: { after: { name: null, claimed: true } } });
      expect((await changesOf(ids['visit-audit']!)).changes).toEqual({ before: { id: 9, contact_id: 1, visitor_name: null }, after: null });
      expect((await changesOf(ids['ben']!)).changes).toMatchObject({ before: { name: 'Ben Other' } });
      expect((await changesOf(ids['elsewhere']!)).changes).toMatchObject({ after: { name: 'Ola' } });
      expect((await changesOf(ids['deal']!)).changes).toMatchObject({ after: { name: 'Desks' } });

      expect(await imageOf(ids[`rm-${CONTACTS}-1`]!)).toEqual({ id: 1, name: null, company_id: 1 });
      expect(await imageOf(ids[`rm-${VISITS}-9`]!)).toEqual({ id: 9, contact_id: 1, visitor_name: null, day: 'Mon' });
      expect(await imageOf(ids[`rm-${VISITS}-10`]!)).toMatchObject({ visitor_name: 'Ben Other' });
      // Written again: nothing more to do.
      expect(await scrubAuditImages(meta, [target])).toBe(0);
      // Only entries written from `since` on.
      expect(await scrubAuditImages(meta, [target], Date.now() + 60_000)).toBe(0);
    });

    it('nulls every text still holding her address, never one holding another that contains it', async () => {
      expect(await sweepAddress(meta, MARTA)).toEqual({ audit: 1, removedRows: 1 });
      expect((await changesOf(ids['note']!)).changes).toEqual({ after: { note: null, keep: 1 } });
      expect((await changesOf(ids['near']!)).changes).toEqual({ after: { note: `Wrote to x${MARTA}.` } });
      expect(await imageOf(ids[`rm-${VISITS}-10`]!)).toEqual({ id: 10, contact_id: 2, visitor_name: 'Ben Other', note: null });
      expect(await sweepAddress(meta, MARTA)).toEqual({ audit: 0, removedRows: 0 });
    });

    it('keeps her campaign sends with the address and name emptied; a waiting one is skipped as stopped', async () => {
      const people = [{ connectionId: conn, table: CONTACTS, tableName: 'crm_contacts', key: '1' }];
      const found = await campaignSendIds(meta, MARTA, people);
      expect(found).toHaveLength(2);
      expect(await blankCampaignSends(meta, found, 99)).toBe(2);
      const sends = await meta.db.selectFrom('adminium_email_sends').select(['seq', 'address', 'name', 'state', 'reason']).where('runId', '=', ids['run']!).orderBy('seq').execute();
      expect(sends.map((row) => ({ ...row, seq: Number(row.seq) }))).toEqual([
        { seq: 1, address: '', name: '', state: 'sent', reason: null },
        { seq: 2, address: '', name: '', state: 'skipped-stop', reason: 'erased' },
        { seq: 3, address: `x${MARTA}`, name: 'Xavier', state: 'queued', reason: null },
        { seq: 4, address: 'ben@other.example', name: 'Ben', state: 'queued', reason: null },
      ]);
    });

    it('deletes the files on her rows, bytes first, and no other', async () => {
      const people = [{ connectionId: conn, table: CONTACTS, tableName: 'crm_contacts', key: '1' }];
      const found = await rowFileIds(meta, people);
      expect(found).toEqual([ids['file-hers']]);
      const removed: string[] = [];
      const store = { remove: async (file: { id: string }) => void removed.push(file.id), driverFor: async () => ({ remove: async () => undefined }) } as unknown as FileStore;
      expect(await purgeRowFiles(meta, store, found)).toEqual({ purged: 1, failed: 0 });
      expect(removed).toEqual([ids['file-hers']]);
      expect(await filesRepo(meta).findById(ids['file-hers']!)).toBeNull();
      expect(await filesRepo(meta).findById(ids['file-ben']!)).not.toBeNull();
      // Bytes that cannot be removed keep the row, and are counted.
      const broken = { remove: async () => Promise.reject(new Error('disk')), driverFor: async () => ({ remove: async () => undefined }) } as unknown as FileStore;
      expect(await purgeRowFiles(meta, broken, [ids['file-ben']!])).toEqual({ purged: 0, failed: 1 });
      expect(await filesRepo(meta).findById(ids['file-ben']!)).not.toBeNull();
    });
  });
}
