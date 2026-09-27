// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CODE TYPED THROUGH A WRITE OF MANY ROWS — a bulk change, a change made
 * beside links or a form's child rows, an import — on every engine this run
 * can reach.
 *
 * A change that types a code finds it within the row's own scope as stored
 * (the order's show), though the change does not send that column: a show's
 * own code is found, never refused as `unknown`. And a code that finds
 * nothing is that row's refusal, named on its column: an import skips that
 * row and writes the others, or stops naming it — never one bare failure
 * for the whole file.
 */
import { Readable } from 'node:stream';

import { filesRepo, importsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FileStore } from '../src/files/store.js';
import { registerImportRunHandler } from '../src/jobs/import-run.js';
import { boxOffice } from './code-lookup-fixture.js';
import { LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

describe.each(LEGS)('a code typed through a write of many rows — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  const stored = async (ref: string, key: unknown) => (await h.rows(`select * from ${h.real(ref)} where id = ${String(key)}`))[0]!;

  /** Import `csv` into sign-ups (name, code): the job's end state, its report, and the rows it wrote. */
  const importCsv = async (csv: string, skipInvalid: boolean) => {
    let report = '';
    const storage = {
      read: async () => Promise.resolve(Readable.from([csv])),
      write: async (input: { bytes: string }) => {
        report = input.bytes;
        return Promise.resolve({ storageKey: 'report', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' });
      },
    } as unknown as FileStore;
    const file = await filesRepo(h.meta).create({ filename: 'signups.csv', mime: 'text/csv', sizeBytes: csv.length, sha256: 'x', kind: 'upload' });
    const imports = importsRepo(h.meta);
    const user = await usersRepo(h.meta).create({ email: `import-${String(Date.now())}-${String(Math.random()).slice(2)}@bloom.dev`, name: 'Importer', passwordHash: 'x' });
    const job = await imports.create({
      connectionId: h.connectionId,
      tableName: w.targetOf('signups').table.id,
      requestedBy: user.id,
      fileId: file.id,
      mapping: { columns: [{ from: 'name', to: 'name' }, { from: 'code', to: 'code_text' }] },
      options: { mode: 'insert', skipInvalid },
    });
    await imports.markReady(job.id, { total: csv.trim().split('\n').length - 1 });
    let handler: ((payload: unknown, ctx: unknown) => Promise<unknown>) | null = null;
    registerImportRunHandler({ registerJobHandler: (_kind: string, _schema: unknown, run: typeof handler) => (handler = run) } as never, { meta: h.meta, manager: h.manager, storage });
    const logged: string[] = [];
    const log = (message: string, data?: Record<string, unknown>) => logged.push(`${message} ${JSON.stringify(data ?? {})}`);
    await handler!({ importId: job.id }, { jobId: 'job_1', signal: new AbortController().signal, progress: () => {}, log });
    return { status: (await imports.findById(job.id))?.status, report, logged: logged.join('\n') };
  };

  beforeAll(async () => {
    if (!available) return;
    h = await boxOffice(dialect);
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('finds a show’s own code typed into a change of many rows, reading the show as stored', async () => {
    const made = await w.create('orders', { event_id: 2, email: 'kai@example.com', name: 'Kai' });
    const target = w.targetOf('orders');
    // The bulk change's door (and undo's, a form's child rows'): the code is the only value sent.
    const [prepared] = await w.writes.beforeEach('update', target, { ...w.desk, origin: 'bulk' }, [{ match: { id: made['id'] }, values: { code_text: 'homeonly' } }]);
    expect(prepared!.issues).toBeNull();
    expect(Number(prepared!.values['code_id'])).toBe(8);
    // Another show's code is still not this order's.
    const [other] = await w.writes.beforeEach('update', target, { ...w.desk, origin: 'bulk' }, [{ match: { id: made['id'] }, values: { code_text: 'CREW5' } }]);
    expect(other!.issues).toEqual({ code_text: { code: 'unknown' } });
    expect((await stored('orders', made['id']))['code_id']).toBeNull();
  });

  it.skipIf(!available)('names the one row whose code finds nothing, and prepares the others', async () => {
    const target = w.targetOf('signups');
    const checked = await w.writes.check('create', target, { ...w.desk, origin: 'import' }, [
      { name: 'Ana', code_text: 'STUDENT10' },
      { name: 'Bo', code_text: 'NOPE' },
      { name: 'Cy', code_text: 'crew5' },
    ]);
    expect(checked.issues).toEqual([null, { code_text: { code: 'unknown' } }, null]);
    expect([Number(checked.rows[0]!['code_id']), checked.rows[1], Number(checked.rows[2]!['code_id'])]).toEqual([1, null, 2]);
    const prepared = await w.writes.beforeEach('create', target, { ...w.desk, origin: 'bulk' }, [{ values: { name: 'Di', code_text: 'nope' } }, { values: { name: 'Ed', code_text: 'venue15' } }]);
    expect(prepared.map((row) => row.issues)).toEqual([{ code_text: { code: 'unknown' } }, null]);
  });

  it.skipIf(!available)('imports every row but the one whose code finds nothing, and names that row', async () => {
    const before = Number((await h.rows(`select count(*) as n from ${h.real('signups')}`))[0]!['n']);
    const skipped = await importCsv('name,code\nAna,STUDENT10\nBo,NOPE\nCy,CREW5\n', true);
    expect(skipped.status).toBe('succeeded');
    expect(Number((await h.rows(`select count(*) as n from ${h.real('signups')}`))[0]!['n'])).toBe(before + 2);
    expect(skipped.report).toContain('code_text');
    expect(skipped.report).toContain('\n2,code_text,REFUSED,code_text: unknown');
    // Not skipping: the import stops, naming the row.
    const stopped = await importCsv('name,code\nDi,VENUE15\nEd,NOPE\n', false);
    expect(stopped.status).toBe('failed');
    expect(stopped.logged).toContain('row 2: code_text: unknown');
  });
});
