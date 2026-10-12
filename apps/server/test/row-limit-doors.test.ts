// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A role whose rows are limited, held to it at the side doors, against the
 * whole server on every engine: a file somebody exports and the files of
 * others, a file brought in, a document drawn of a record and one kept, a
 * file hung on a record, the audit log, a rule and its runs, the figures a
 * model is sent, and the schema's row counts.
 *
 * The clock is the real one: Dana reaches deals 1, 2, 5 and 9 (her own two,
 * and Lena's two that she covers); Mara, who leads Dana and Omar, reaches
 * 1, 2, 3, 4, 5 and 9. Lena's role limits nothing.
 */
import { auditRepo, automationRunsRepo, documentProfilesRepo, documentsRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDocumentPipeline } from '../src/documents/compose.js';
import { createConnectionStatsCollector } from '../src/llm/stats-collector.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
const TEAM = { reach: 'team' } as const;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

type Who = PersonName | 'owner';
type Reply = { statusCode: number; body: string; headers: Record<string, unknown> };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`the side doors of a limited table [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: await as(who), ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) }) as unknown as Reply;
    const get = (who: Who, url: string) => call(who, 'GET', url);
    const post = (who: Who, url: string, payload: unknown = {}) => call(who, 'POST', url, payload);
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const deals = (): string => w.id('deals');
    const keysIn = (csv: string): number[] =>
      csv
        .replace(/^\uFEFF/, '')
        .trim()
        .split(/\r?\n/)
        .slice(1)
        .map((line) => Number(line.split(',')[0]))
        .sort((a, b) => a - b);

    /** Ask for a file of the deals, run the job, and answer the export's id. */
    const exportDeals = async (who: Who, run = true): Promise<string> => {
      const res = await post(who, 'exports', { connectionId: w.connectionId, source: { kind: 'table', table: deals() }, format: 'csv' });
      expect(res.statusCode, res.body).toBe(202);
      if (run) await w.jobs();
      return json<{ data: { id: string } }>(res).data.id;
    };
    const download = (who: Who, id: string) => get(who, `exports/${id}/download`);

    /** Bring a CSV in to the deals as somebody, run the job, and answer the import as its owner sees it. */
    const importDeals = async (who: Who, csv: string, options: Record<string, unknown>): Promise<{ id: string; status: string; stats: { total: number; inserted?: number; updated?: number; skipped?: number } | null; statusCode: number; body: string }> => {
      const uploaded = await call(who, 'POST', 'imports/upload?filename=deals.csv', csv, { 'content-type': 'text/csv' });
      expect(uploaded.statusCode, uploaded.body).toBe(201);
      const header = csv.split('\n')[0]!.split(',');
      const made = await post(who, 'imports', { fileId: json<{ data: { fileId: string } }>(uploaded).data.fileId, connectionId: w.connectionId, table: deals(), mapping: { columns: header.map((name) => ({ from: name, to: name })) }, options: { skipInvalid: true, ...options } });
      if (made.statusCode !== 201) return { id: '', status: 'refused', stats: null, statusCode: made.statusCode, body: made.body };
      const id = json<{ data: { import: { id: string } } }>(made).data.import.id;
      const run = await post(who, `imports/${id}/run`);
      if (run.statusCode !== 202) return { id, status: 'refused', stats: null, statusCode: run.statusCode, body: run.body };
      await w.jobs();
      const view = json<{ data: { status: string; stats: { total: number } | null } }>(await get(who, `imports/${id}`)).data;
      return { id, status: view.status, stats: view.stats, statusCode: 202, body: '' };
    };

    const upload = (who: Who, query: Record<string, string>) => call(who, 'POST', `files?${new URLSearchParams({ connectionId: w.connectionId, ...query }).toString()}`, PDF, { 'content-type': 'application/pdf' });
    const fileOn = async (who: Who, record: number | null, filename: string): Promise<string> => {
      const res = await upload(who, { filename, table: deals(), ...(record === null ? {} : { recordId: String(record) }) });
      expect(res.statusCode, res.body).toBe(201);
      return json<{ data: { id: string } }>(res).data.id;
    };

    beforeAll(async () => {
      w = await world(dialect);
      const all = ['read', 'create', 'update', 'delete', 'export', 'import'] as const;
      await w.role('rep', {
        deals: { actions: [...all], rows: { read: OWN, update: OWN, delete: OWN } },
        followups: { actions: ['read'], rows: { read: OWN } },
        quotes: { actions: ['read'], rows: { read: OWN } },
        companies: { actions: ['read'] },
      });
      await w.role('manager', { deals: { actions: [...all], rows: { read: TEAM, update: TEAM, delete: TEAM } }, followups: { actions: ['read'], rows: { read: TEAM } }, companies: { actions: ['read'] } });
      await w.role('reader', { deals: { actions: [...all] }, followups: { actions: ['read'] }, quotes: { actions: ['read'] }, companies: { actions: ['read'] } });
      // What looks after the workspace's files, logs and rules: held by all three, so only the rows tell them apart.
      await w.system('keeper', ['exports.manage', 'imports.manage', 'files.manage', 'audit.read', 'automations.manage', 'llm.run', 'settings.manage']);
      for (const person of ['dana', 'omar'] as const) await w.give(person, 'rep');
      await w.give('mara', 'manager');
      await w.give('lena', 'reader');
      for (const person of ['dana', 'mara', 'lena'] as const) await w.give(person, 'keeper');
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    describe('a file of a table (X1–X4)', () => {
      it('holds the rows its requester reaches', async () => {
        expect(keysIn((await download('dana', await exportDeals('dana'))).body)).toEqual([1, 2, 5, 9]);
        expect(keysIn((await download('mara', await exportDeals('mara'))).body)).toEqual([1, 2, 3, 4, 5, 9]);
        expect(keysIn((await download('lena', await exportDeals('lena'))).body)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      });

      it('holds them as the requester\'s roles stand when the job runs, not when it was asked for', async () => {
        await w.give('omar', 'reader');
        cookies.delete('omar');
        const id = await exportDeals('omar', false);
        await w.take('omar', 'reader');
        await w.jobs();
        // Omar's own are 3 and 4; the cover for Sam ended in August.
        expect(keysIn((await download('omar', id)).body)).toEqual([3, 4]);
      });

      it('is not written for somebody whose grant to export the table was taken away while it waited', async () => {
        await w.role('exporter', { deals: { actions: ['read', 'export'] } });
        await w.give('kim', 'exporter');
        const id = await exportDeals('kim', false);
        await w.take('kim', 'exporter');
        await w.jobs();
        const made = await w.meta.db.selectFrom('adminium_exports').select(['status', 'fileId']).where('id', '=', id).executeTakeFirstOrThrow();
        expect([made.status, made.fileId]).toEqual(['failed', null]);
      });

      it('is opened and listed by another person only when nothing limits them on its table', async () => {
        const lenas = await exportDeals('lena');
        const danas = await exportDeals('dana');
        const missing = await download('dana', 'exp_nothing_here');
        for (const limited of ['dana', 'mara'] as const) {
          const refused = await download(limited, lenas);
          expect([refused.statusCode, json<{ error: { code: string } }>(refused).error.code]).toEqual([missing.statusCode, json<{ error: { code: string } }>(missing).error.code]);
          expect((await get(limited, `exports/${lenas}`)).statusCode).toBe(404);
          expect(json<{ data: { id: string }[] }>(await get(limited, 'exports')).data.map((row) => row.id)).not.toContain(lenas);
        }
        // Lena holds the same grant, and nothing limits her: she looks after everybody's.
        expect((await download('lena', danas)).statusCode).toBe(200);
        expect(json<{ data: { id: string }[] }>(await get('lena', 'exports')).data.map((row) => row.id)).toContain(danas);
      });

      it('is counted and previewed over the rows the asker would get', async () => {
        const countOf = async (who: Who): Promise<number | null> =>
          json<{ data: { tables: { id: string; rowCountEstimate: number | null }[] } }>(await get(who, `exports/sources?connectionId=${w.connectionId}`)).data.tables.find((table) => table.id === deals())!.rowCountEstimate;
        expect(await countOf('dana')).toBe(4);
        expect(await countOf('mara')).toBe(6);
        expect(await countOf('lena')).toBe(9);
        const preview = async (who: Who) => json<{ data: { rowCount: number | null; rowCountKind: string; rows: unknown[] } }>(await post(who, 'exports/preview', { connectionId: w.connectionId, source: { kind: 'table', table: deals() }, format: 'csv', sampleRows: 20 })).data;
        const hers = await preview('dana');
        expect([hers.rowCount, hers.rowCountKind, hers.rows.length]).toEqual([4, 'exact', 4]);
        expect((await preview('lena')).rows.length).toBe(9);
      });
    });

    describe('a file brought in (I1, I2)', () => {
      it('changes only rows its requester reaches, and names only people and rows they may', async () => {
        // Deal 1 is Dana's; deal 3 is Omar's; 999 is nobody's row.
        const done = await importDeals('dana', 'id,title\n1,Renamed by Dana\n3,Not hers to rename\n', { mode: 'upsert', matchColumn: 'id' });
        expect(done.status, done.body).not.toBe('refused');
        const titles = Object.fromEntries((await w.rows('SELECT id, title FROM deals WHERE id IN (1, 3)')).map((row) => [Number(row['id']), row['title']]));
        expect(titles).toEqual({ 1: 'Renamed by Dana', 3: 'Deal 3' });
        await w.run(`UPDATE deals SET title = 'Deal 1' WHERE id = 1`);

        // A new deal in a colleague's name is refused; one in her own is made.
        const made = await importDeals('dana', `id,title,owner_id,state,amount,big\n101,Hers,${w.people.dana},open,10,0\n102,His,${w.people.omar},open,10,0\n`, { mode: 'insert' });
        expect(made.status, made.body).not.toBe('refused');
        expect((await w.rows('SELECT id FROM deals WHERE id IN (101, 102)')).map((row) => Number(row['id']))).toEqual([101]);
        await w.run('DELETE FROM deals WHERE id IN (101, 102)');

        // Lena, whom nothing limits, renames Omar's as she always could.
        await importDeals('lena', 'id,title\n3,Renamed by Lena\n', { mode: 'upsert', matchColumn: 'id' });
        expect((await w.rows('SELECT title FROM deals WHERE id = 3'))[0]!['title']).toBe('Renamed by Lena');
        await w.run(`UPDATE deals SET title = 'Deal 3' WHERE id = 3`);
      });

      it('is matched on a column no two rows share, for somebody who reaches only some rows', async () => {
        const done = await importDeals('dana', 'title,amount\nDeal 3,1\n', { mode: 'upsert', matchColumn: 'title' });
        // Refused where it is asked for, or failed when it runs: either way no row is written.
        expect(['refused', 'failed']).toContain(done.status);
        expect(Number((await w.rows('SELECT amount FROM deals WHERE id = 3'))[0]!['amount'])).toBe(8000);
      });

      it('and its report of refused rows are opened by another person only when nothing limits them on its table', async () => {
        const done = await importDeals('lena', 'id,title\n3,Deal 3\n', { mode: 'upsert', matchColumn: 'id' });
        const missing = await get('dana', 'imports/imp_nothing_here');
        for (const limited of ['dana', 'mara'] as const) {
          expect((await get(limited, `imports/${done.id}`)).statusCode).toBe(missing.statusCode);
          expect((await get(limited, `imports/${done.id}/error-report`)).statusCode).toBe(missing.statusCode);
          expect(json<{ data: { id: string }[] }>(await get(limited, 'imports')).data.map((row) => row.id)).not.toContain(done.id);
        }
        const danas = await importDeals('dana', 'id,title\n1,Deal 1\n', { mode: 'upsert', matchColumn: 'id' });
        expect((await get('lena', `imports/${danas.id}`)).statusCode).toBe(200);
      });
    });

    describe('a document (P1, P3)', () => {
      let plain: string;
      let lined: string;
      const kept: Record<string, string> = {};

      beforeAll(async () => {
        const profiles = documentProfilesRepo(w.meta);
        plain = (await profiles.create({ addOnKey: 'invoices', kind: 'invoice', name: 'Deal sheet', connectionId: w.connectionId, table: deals(), mapping: { customerName: { column: 'title' } } })).id;
        // …and one that lists the follow-ups under the deal: a table the rep and the manager read in part.
        lined = (await profiles.create({ addOnKey: 'invoices', kind: 'quote', name: 'Deal with follow-ups', connectionId: w.connectionId, table: deals(), mapping: { customerName: { column: 'title' }, items: { collection: { table: w.id('followups'), fkColumn: 'deal_id', columns: {} } } } })).id;
        const keep = async (name: string, profileId: string, kind: string, deal: number): Promise<void> => {
          kept[name] = (
            await documentsRepo(w.meta).create({ profileId, addOnKey: 'invoices', kind, connectionId: w.connectionId, entity: { connectionId: w.connectionId, table: deals(), pk: { id: deal }, label: `Deal ${String(deal)}` }, subject: { fields: { customerName: `Deal ${String(deal)}` } }, locale: 'en-US', format: 'pdf' })
          ).id;
        };
        await keep('hers', plain, 'invoice', 1);
        await keep('omars', plain, 'invoice', 3);
        await keep('hersLined', lined, 'quote', 1);
      });

      it('that is kept is not there for somebody who does not reach its record, or reads its other tables in part', async () => {
        const missing = await get('dana', 'documents/doc_nothing_here');
        const listed = async (who: Who): Promise<string[]> => json<{ documents: { id: string }[] }>(await get(who, `documents?entityTable=${encodeURIComponent(deals())}`)).documents.map((row) => row.id);
        expect((await get('dana', `documents/${kept['hers']!}`)).statusCode).toBe(200);
        for (const name of ['omars', 'hersLined']) {
          const res = await get('dana', `documents/${kept[name]!}`);
          expect([res.statusCode, json<{ error: { code: string } }>(res).error.code], name).toEqual([missing.statusCode, json<{ error: { code: string } }>(missing).error.code]);
          expect((await get('dana', `documents/${kept[name]!}/content`)).statusCode, name).toBe(404);
          expect((await get('dana', `documents/${kept[name]!}/print`)).statusCode, name).toBe(404);
        }
        expect((await listed('dana')).sort()).toEqual([kept['hers']!]);
        // Mara leads Omar, so his deal's sheet is hers to read; the one with follow-ups is not, for her either.
        expect((await listed('mara')).sort()).toEqual([kept['hers']!, kept['omars']!].sort());
        expect((await listed('lena')).sort()).toEqual(Object.values(kept).sort());
      });

      it('that is kept answers as one that is not there before any other refusal is said', async () => {
        // Its lines are a table Dana's role does not read at all: of her own deal it is there and closed to her; of Omar's it is not there.
        const profile = await documentProfilesRepo(w.meta).create({ addOnKey: 'invoices', kind: 'receipt', name: 'Deal with lines', connectionId: w.connectionId, table: deals(), mapping: { customerName: { column: 'title' }, items: { collection: { table: w.id('quote_lines'), fkColumn: 'quote_id', columns: {} } } } });
        const keep = async (deal: number): Promise<string> =>
          (await documentsRepo(w.meta).create({ profileId: profile.id, addOnKey: 'invoices', kind: 'receipt', connectionId: w.connectionId, entity: { connectionId: w.connectionId, table: deals(), pk: { id: deal }, label: `Deal ${String(deal)}` }, subject: { fields: {} }, locale: 'en-US', format: 'pdf' })).id;
        const [hers, his] = [await keep(1), await keep(3)];
        expect((await get('dana', `documents/${hers}`)).statusCode).toBe(200);
        expect((await get('dana', `documents/${hers}/content`)).statusCode).toBe(403);
        expect((await get('dana', `documents/${his}`)).statusCode).toBe(404);
        expect((await get('dana', `documents/${his}/content`)).statusCode).toBe(404);
        const listed = json<{ documents: { id: string }[] }>(await get('dana', `documents?entityTable=${encodeURIComponent(deals())}`)).documents.map((row) => row.id);
        expect([listed.includes(hers), listed.includes(his)]).toEqual([true, false]);
        await w.meta.db.deleteFrom('adminium_documents').where('id', 'in', [hers, his]).execute();
      });

      it('that is kept is voided only by somebody whose update reaches its record', async () => {
        const res = await post('dana', `documents/${kept['omars']!}/void`, { reason: 'operator' });
        expect(res.statusCode, res.body).toBe(404);
        expect((await documentsRepo(w.meta).findById(kept['omars']!))!.status).not.toBe('void');
      });

      it('is drawn of a record its asker reaches, and of other tables they read whole', async () => {
        const pipeline = createDocumentPipeline({ meta: w.meta, manager: w.manager, storage: {} as never, runtime: () => null });
        const profiles = documentProfilesRepo(w.meta);
        const read = async (who: PersonName, profileId: string, deal: number) =>
          pipeline.readSource({ profile: (await profiles.findById(profileId))!, pk: { id: deal }, tables: [], at: Date.now(), reader: w.people[who] });
        expect(await read('dana', plain, 1)).not.toBeNull();
        // Omar's deal answers as a deal that is not there…
        expect(await read('dana', plain, 3)).toBeNull();
        expect(await read('dana', plain, 999)).toBeNull();
        // …and a page that lists follow-ups is drawn for nobody who reads only some of them.
        expect(await read('dana', lined, 1)).toBeNull();
        expect(await read('mara', plain, 3)).not.toBeNull();
        expect(await read('lena', lined, 3)).not.toBeNull();
        // A rule's render names no reader, and reads as it always did.
        expect(await pipeline.readSource({ profile: (await profiles.findById(plain))!, pk: { id: 3 }, tables: [], at: Date.now() })).not.toBeNull();
      });

      it('is refused before anything is queued when it lists rows of a table its asker reads in part', async () => {
        const refused = await post('dana', 'documents/render', { profileId: lined, pk: { id: 1 } });
        expect(refused.statusCode, refused.body).toBe(403);
        expect(json<{ error: { code: string; details: { reason: string } } }>(refused).error).toMatchObject({ code: 'TABLE_FORBIDDEN', details: { reason: 'row-limit' } });
        // A record out of reach is asked for exactly as one that is not there: both are queued, and neither is drawn.
        const [his, none] = [await post('dana', 'documents/render', { profileId: plain, pk: { id: 3 } }), await post('dana', 'documents/render', { profileId: plain, pk: { id: 999 } })];
        expect([his.statusCode, Object.keys(json(his))]).toEqual([none.statusCode, Object.keys(json(none))]);
        await w.jobs();
      });

      it('is never drawn by a job somebody posts', async () => {
        const res = await post('owner', 'jobs', { kind: 'document.render', payload: { profileId: plain, pk: { id: 3 }, requestedBy: w.people.lena, actorKind: 'user' } });
        expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
      });
    });

    describe('a file hung on a record (F1–F3)', () => {
      let hers: string;
      let omars: string;
      let inFlight: string;

      beforeAll(async () => {
        hers = await fileOn('owner', 1, 'hers.pdf');
        omars = await fileOn('owner', 3, 'omars.pdf');
        // Uploaded by Omar for a deal he has not saved yet.
        inFlight = await fileOn('omar', null, 'in-flight.pdf');
      });

      it('is read with its record, by the holder of files.manage too', async () => {
        const missing = await get('dana', 'files/file_nothing_here');
        expect((await get('dana', `files/${hers}`)).statusCode).toBe(200);
        expect((await get('dana', `files/${hers}/content`)).statusCode).toBe(200);
        for (const id of [omars]) {
          const res = await get('dana', `files/${id}`);
          expect(res.statusCode, res.body).toBe(404);
          expect([res.statusCode, json<{ error: { code: string } }>(res).error.code]).toEqual([missing.statusCode, json<{ error: { code: string } }>(missing).error.code]);
          expect((await get('dana', `files/${id}/content`)).statusCode).toBe(404);
        }
        const listed = async (who: Who): Promise<string[]> => json<{ data: { id: string }[] }>(await get(who, `files?connectionId=${w.connectionId}&table=${encodeURIComponent(deals())}&state=live`)).data.map((row) => row.id);
        expect(await listed('dana')).toContain(hers);
        expect(await listed('dana')).not.toContain(omars);
        expect(await listed('mara')).toEqual(expect.arrayContaining([hers, omars]));
        expect(await listed('lena')).toEqual(expect.arrayContaining([hers, omars]));
        const resolved = json<{ data: Record<string, unknown> }>(await post('dana', 'files/resolve', { refs: [hers, omars] })).data;
        expect([resolved[hers] === null, resolved[omars] === null]).toEqual([false, true]);
        // An upload that has no record yet keeps no table either: it is its uploader's, and the file keepers'.
        expect((await get('omar', `files/${inFlight}`)).statusCode).toBe(200);
        expect(json<{ data: { entity: unknown } }>(await get('lena', `files/${inFlight}`)).data.entity).toBeNull();
      });

      it('is changed, taken off, binned and restored only with its record', async () => {
        for (const [method, url, payload] of [
          ['PATCH', `files/${omars}`, { filename: 'renamed.pdf' }],
          ['POST', `files/${omars}/detach`, {}],
          ['DELETE', `files/${omars}`, undefined],
          ['POST', `files/${omars}/restore`, {}],
        ] as const) {
          const res = await call('dana', method, url, payload);
          expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(404);
        }
        const still = json<{ data: { filename: string; deletedAt: number | null; entity: { recordId: string } | null } }>(await get('lena', `files/${omars}`)).data;
        expect([still.filename, still.deletedAt, still.entity?.recordId]).toEqual(['omars.pdf', null, '3']);
        // Her own record's file she renames.
        expect((await call('dana', 'PATCH', `files/${hers}`, { filename: 'hers-2.pdf' })).statusCode).toBe(200);
      });

      it('is hung only on a record its uploader reaches', async () => {
        const refused = await upload('dana', { filename: 'sneak.pdf', table: deals(), recordId: '3' });
        expect(refused.statusCode, refused.body).toBe(404);
        const ok = await upload('dana', { filename: 'fine.pdf', table: deals(), recordId: '2' });
        expect(ok.statusCode, ok.body).toBe(201);
        // …and one she uploaded for a new deal is not then attached to a colleague's.
        const loose = await fileOn('dana', null, 'loose.pdf');
        const attach = await post('dana', `files/${loose}/attach`, { connectionId: w.connectionId, table: deals(), recordId: '3' });
        expect(attach.statusCode, attach.body).toBe(404);
        expect((await post('dana', `files/${loose}/attach`, { connectionId: w.connectionId, table: deals(), recordId: '1' })).statusCode).toBe(200);
      });

      it('is not attached to an email by somebody who does not reach its record', async () => {
        const made = await post('dana', 'email-templates', { kind: 'template', name: 'A note' });
        expect(made.statusCode, made.body).toBe(201);
        const detail = json<{ id: string; name: string; category: string; document: Record<string, unknown> }>(made);
        const put = (who: Who, fileId: string) =>
          call(who, 'PUT', `email-templates/${detail.id}`, { name: detail.name, category: detail.category, enabled: false, document: { ...detail.document, attachments: [{ id: 'a1', kind: 'file', fileId }] } });
        const refused = await put('dana', omars);
        expect(refused.statusCode, refused.body).toBe(422);
        expect((await put('dana', hers)).statusCode).toBe(200);
        // A picture in a block is a file sent too.
        const pictured = (who: Who, fileId: string) =>
          call(who, 'PUT', `email-templates/${detail.id}`, { name: detail.name, category: detail.category, enabled: false, document: { ...detail.document, blocks: [{ id: 'img1', block: 'email.image', data: { fileId, alt: 'x' }, style: {} }] } });
        expect((await pictured('dana', omars)).statusCode).toBe(422);
        // Somebody's export is no file to attach, for anybody.
        const exported = (await w.meta.db.selectFrom('adminium_exports').select('fileId').where('id', '=', await exportDeals('lena')).executeTakeFirstOrThrow()).fileId!;
        for (const who of ['dana', 'lena'] as const) expect((await put(who, exported)).statusCode, who).toBe(422);
        expect((await put('lena', omars)).statusCode).toBe(200);
        // What the stored document already names is saved again by anybody.
        expect((await put('dana', omars)).statusCode).toBe(200);
      });
    });

    describe('the audit log (A1)', () => {
      it('leaves out the entries of a table its reader reads in part', async () => {
        const changed = await call('owner', 'PATCH', `data/${w.connectionId}/${encodeURIComponent(deals())}/3`, { values: { amount: 8001 } });
        expect(changed.statusCode, changed.body).toBe(200);
        await w.run('UPDATE deals SET amount = 8000 WHERE id = 3');
        const entries = async (who: Who) => json<{ entries: { id: string; action: string; entity: { table?: string } | null }[] }>(await get(who, 'audit?limit=200')).entries;
        const ofDeals = (list: Awaited<ReturnType<typeof entries>>) => list.filter((entry) => entry.entity?.table === deals());
        const whole = ofDeals(await entries('lena'));
        expect(whole.length).toBeGreaterThan(0);
        for (const limited of ['dana', 'mara'] as const) {
          const seen = await entries(limited);
          expect(ofDeals(seen)).toEqual([]);
          // Everything else in the log is still theirs to read.
          expect(seen.length).toBeGreaterThan(0);
          const one = await get(limited, `audit/${whole[0]!.id}`);
          const missing = await get(limited, 'audit/aud_nothing_here');
          expect([one.statusCode, json<{ error: { code: string } }>(one).error.code]).toEqual([missing.statusCode, json<{ error: { code: string } }>(missing).error.code]);
        }
        expect((await get('lena', `audit/${whole[0]!.id}`)).statusCode).toBe(200);
        // A file hung on a deal names the table in what changed, not in an entity: left out the same way.
        const named = (await auditRepo(w.meta).list({ limit: 500 })).filter((entry) => entry.action === 'file.upload').map((entry) => entry.id);
        expect(named.length).toBeGreaterThan(0);
        expect((await entries('dana')).filter((entry) => named.includes(entry.id))).toEqual([]);
      });

      it('never ends a page on an entry it left out', async () => {
        // A file of Omar's deal renamed by Lena: the entry names the table, not a record.
        const omars = await fileOn('owner', 3, 'cursor.pdf');
        expect((await call('lena', 'PATCH', `files/${omars}`, { filename: 'cursor-2.pdf' })).statusCode).toBe(200);
        const hidden = new Set((await auditRepo(w.meta).list({ limit: 1000 })).filter((entry) => JSON.stringify([entry.entity, entry.changes]).includes(deals())).map((entry) => entry.id));
        expect(hidden.size).toBeGreaterThan(2);
        // Asked for by the record, one at a time: nothing, and no cursor to follow.
        const byRecord = json<{ entries: unknown[]; nextCursor: string | null }>(await get('dana', `audit?limit=1&connectionId=${w.connectionId}&entityTable=${encodeURIComponent(deals())}&entityId=3`));
        expect(byRecord).toEqual({ entries: [], nextCursor: null });
        // The whole log, one at a time: every cursor is the entry just answered.
        let cursor: string | null = null;
        let pages = 0;
        const seen: string[] = [];
        do {
          const page: { entries: { id: string }[]; nextCursor: string | null } = json(await get('dana', `audit?limit=1${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`));
          for (const entry of page.entries) seen.push(entry.id);
          if (page.nextCursor !== null) {
            const named = Buffer.from(page.nextCursor, 'base64url').toString('utf8').split(':').slice(1).join(':');
            expect(hidden.has(named), 'a cursor names an entry that was left out').toBe(false);
            expect(named).toBe(page.entries.at(-1)?.id);
          }
          cursor = page.nextCursor;
          pages += 1;
        } while (cursor !== null && pages < 400);
        expect(seen.filter((id) => hidden.has(id))).toEqual([]);
        expect(seen.length).toBeGreaterThan(3);
        expect(new Set(seen).size).toBe(seen.length);
        // Lena pages through the same log and is shown every one of them.
        const all = json<{ entries: { id: string }[] }>(await get('lena', 'audit?limit=200')).entries.map((entry) => entry.id);
        expect([...hidden].filter((id) => all.includes(id)).length).toBeGreaterThan(2);
      });
    });

    describe('a rule and its runs (U1–U3)', () => {
      const rule = (name: string) => ({
        name,
        connectionId: w.connectionId,
        trigger: { kind: 'record', event: 'updated', connectionId: w.connectionId, table: deals(), watch: true },
        graph: { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'When a deal changes' }, { id: 'n2', kind: 'action', title: 'Send email', onError: false, action: { kind: 'email', templateKey: null, to: null, vars: {} } }] },
        enabled: false,
      });
      const refusal = (res: Reply) => [res.statusCode, json<{ error: { code: string; details?: { reason?: string } } }>(res).error.code, json<{ error: { details?: { reason?: string } } }>(res).error.details?.reason];

      it('is saved, copied, switched on and tried only by somebody who reads every row it reads', async () => {
        for (const limited of ['dana', 'mara'] as const) expect(refusal(await post(limited, 'automations', rule('Mail me every deal')))).toEqual([403, 'TABLE_FORBIDDEN', 'row-limit']);
        const made = await post('lena', 'automations', rule('Lena watches deals'));
        expect(made.statusCode, made.body).toBe(201);
        const id = json<{ id: string }>(made).id;
        expect(refusal(await post('dana', `automations/${id}/duplicate`))).toEqual([403, 'TABLE_FORBIDDEN', 'row-limit']);
        expect(refusal(await call('dana', 'PATCH', `automations/${id}`, { enabled: true }))).toEqual([403, 'TABLE_FORBIDDEN', 'row-limit']);
        const tried = await post('dana', `automations/${id}/test`, { trigger: rule('x').trigger, graph: rule('x').graph });
        expect(refusal(tried)).toEqual([403, 'TABLE_FORBIDDEN', 'row-limit']);
        // A rename reads nothing, and is hers to make.
        expect((await call('dana', 'PATCH', `automations/${id}`, { name: 'Renamed' })).statusCode).toBe(200);
        expect((await post('lena', `automations/${id}/duplicate`)).statusCode).toBe(201);
      });

      it('is not a way to change rows its author\'s own update does not reach', async () => {
        // Kim reads every deal and changes only her own.
        await w.role('half', { deals: { actions: ['read', 'update'], rows: { update: OWN } } });
        await w.give('kim', 'half');
        await w.give('kim', 'keeper');
        cookies.delete('kim');
        const changing = { ...rule('Take every deal'), graph: { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'When a deal changes' }, { id: 'n2', kind: 'action', title: 'Update field', onError: false, action: { kind: 'record.update', values: {} } }] } };
        expect(refusal(await post('kim', 'automations', changing))).toEqual([403, 'TABLE_FORBIDDEN', 'row-limit']);
        // One that only reads is hers to write: she reads them all.
        expect((await post('kim', 'automations', rule('Kim watches deals'))).statusCode).toBe(201);
        expect((await post('lena', 'automations', changing)).statusCode).toBe(201);
      });

      it('shows what a run read only to somebody who reads every row of its table', async () => {
        const id = json<{ id: string }>(await post('lena', 'automations', rule('Runs'))).id;
        const run = await automationRunsRepo(w.meta).begin(
          { automationId: id, dedupeKey: `k-${dialect}`, origin: 'watch', triggerEvent: { event: 'record.updated', origin: 'watch', hops: 0, record: { connectionId: w.connectionId, table: deals(), pk: { id: 3 }, label: 'Deal 3' }, snapshot: { id: 3, title: 'Deal 3', amount: 8000 }, occurredAt: Date.now() } },
          Date.now(),
        );
        await automationRunsRepo(w.meta).finish(run!.id, { status: 'failed', durationMs: 3, trace: { version: 1, steps: [{ nodeId: 'n2', name: 'Send email', kind: 'action', status: 'fail', startedAt: Date.now(), durationMs: 3, log: 'to omar@firm.test about Deal 3' }], resume: null }, error: 'Deal 3 has no address' }, Date.now());
        type Seen = { run: { status: string; trace: { steps: { log: string | null }[] } | null; triggerEvent: { record: unknown; snapshot: unknown }; error: string | null } };
        const hers = json<Seen>(await get('dana', `automation-runs/${run!.id}`)).run;
        expect(hers.status).toBe('failed');
        expect([hers.triggerEvent.record, hers.triggerEvent.snapshot, hers.trace?.steps.map((step) => step.log)]).toEqual([null, null, [null]]);
        expect(hers.error).not.toContain('Deal 3');
        const whole = json<Seen>(await get('lena', `automation-runs/${run!.id}`)).run;
        expect([whole.triggerEvent.snapshot, whole.trace?.steps[0]?.log, whole.error]).toEqual([{ id: 3, title: 'Deal 3', amount: 8000 }, 'to omar@firm.test about Deal 3', 'Deal 3 has no address']);
      });
    });

    describe('the figures a model is sent (G1)', () => {
      it('leave out a table the asker reads in part', async () => {
        const model = await w.model();
        const collect = createConnectionStatsCollector({ manager: w.manager });
        const all = await collect({ connectionId: w.connectionId, snapshotId: 's', model: model as never, sampling: null });
        const without = await collect({ connectionId: w.connectionId, snapshotId: 's', model: model as never, sampling: null, without: new Set([deals()]) });
        const names = (list: readonly { table: { name: string } }[]) => list.map((one) => one.table.name);
        expect(names(all as never)).toContain('deals');
        expect(names(without as never)).not.toContain('deals');
        expect(without.length).toBe(all.length - 1);
      });

      it('are opened by another person only when no table of the connection limits them', async () => {
        const made = await post('lena', 'llm/runs', { connectionId: w.connectionId, path: 'byo' });
        expect(made.statusCode, made.body).toBe(201);
        const id = json<{ run: { id: string } }>(made).run.id;
        const missing = await get('dana', 'llm/runs/run_nothing_here');
        for (const url of [`llm/runs/${id}`, `llm/runs/${id}/prompt`, `llm/runs/${id}/diff`]) {
          const res = await get('dana', url);
          expect([res.statusCode, json<{ error: { code: string } }>(res).error.code], url).toEqual([missing.statusCode, json<{ error: { code: string } }>(missing).error.code]);
        }
        const applied = await post('dana', `llm/runs/${id}/apply`, { accepted: [] });
        expect([applied.statusCode, json<{ error: { code: string } }>(applied).error.code]).toEqual([missing.statusCode, json<{ error: { code: string } }>(missing).error.code]);
        expect((await get('lena', `llm/runs/${id}`)).statusCode).toBe(200);
        // The Super Admin is limited only on the private table, which is in nobody's figures.
        expect((await get('owner', `llm/runs/${id}`)).statusCode).toBe(200);
        // Her own run she opens.
        const own = json<{ run: { id: string } }>(await post('dana', 'llm/runs', { connectionId: w.connectionId, path: 'byo' })).run.id;
        expect((await get('dana', `llm/runs/${own}/prompt`)).statusCode).toBe(200);
      });
    });

    describe('the schema (H1)', () => {
      it('tells nobody how many rows a table they read in part holds', async () => {
        // The stored snapshot, as an introspection that counted would have left it.
        const stored = (await snapshotsRepo(w.meta).latest(w.connectionId))!;
        const schema = stored.schema as { tables: Record<string, unknown>[] };
        await w.meta.db.updateTable('adminium_schema_snapshots').set({ schema: JSON.stringify({ ...schema, tables: schema.tables.map((table) => ({ ...table, rowCountEstimate: 9 })) }) as never }).where('id', '=', stored.id).execute();
        const tables = async (who: Who, raw: boolean) => json<{ model: { tables: Record<string, unknown>[] } }>(await get(who, `connections/${w.connectionId}/schema${raw ? '?raw=true' : ''}`)).model.tables;
        for (const raw of [false, true]) {
          const hers = await tables('dana', raw);
          expect('rowCountEstimate' in hers.find((table) => table['id'] === deals())!, String(raw)).toBe(false);
          expect(hers.find((table) => table['id'] === w.id('companies'))!['rowCountEstimate'], String(raw)).toBe(9);
          expect((await tables('lena', raw)).find((table) => table['id'] === deals())!['rowCountEstimate'], String(raw)).toBe(9);
        }
      });
    });
  });
}
