// SPDX-License-Identifier: AGPL-3.0-only
/**
 * reportDocumentsRepo — the verbs (wave 0030).
 *
 * The assertions that carry the wave are the two placements, because the
 * manager's order IS the comp's array order and the comp never sorts: a new
 * document is prepended (`createFrom` 553), a duplicate lands DIRECTLY after
 * its source (`duplicate` 555). Beside them: the tab badges ignore every
 * filter (580), and a body carrying the block ARRAY — a kind repeating, a
 * float, unicode — round-trips through the open record unchanged.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  firstRun,
  reportDocumentsRepo,
  usersRepo,
  type CreateReportDocumentInput,
  type ReportDocumentsRepo,
  type ReportSummary,
} from '../src/index.js';
import { TEST_DIALECTS, useMetaDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const SUMMARY: ReportSummary = {
  reportTitle: 'Q3 2026 Executive Summary',
  kicker: 'Quarterly report',
  accent: '#4f46e5',
  blockCount: 4,
  kpiCount: 3,
  series: [52, 68, 60, 82, 74, 96],
  starterIcon: 'briefcase',
};

/**
 * A body with every JSON shape the envelope carries — and, unlike 0027's, a
 * kind that REPEATS (two `kpi` blocks, the scorecard starter's shape, comp
 * 491), a per-block `w`/`show`, a float series value and unicode.
 */
const BODY = {
  accent: '#4f46e5',
  kicker: 'Quarterly report',
  reportTitle: 'Q3 2026 Executive Summary',
  subtitle: 'For the leadership team · Jul 1 – Sep 30',
  bgImage: '',
  bgTint: 0.82,
  blocks: [
    { id: 'blk400', kind: 'kpi', title: 'North stars', w: 'full', show: true, kpis: [{ label: 'MRR', value: '$482k', delta: '+12%' }] },
    { id: 'blk403', kind: 'kpi', title: 'Operations', w: 'half', show: false, kpis: [{ label: 'Uptime', value: '99.98%', delta: '' }] },
    { id: 'blk406', kind: 'bar', title: 'Revenue by month', w: 'full', show: true, series: [{ label: 'Apr', value: 52.5 }] },
    { id: 'blk409', kind: 'table', title: '売上', w: 'full', show: true, rows: [['Account', 'Revenue'], ['Northwind', '$182k']] },
  ],
};

function input(over: Partial<CreateReportDocumentInput> & { name: string }): CreateReportDocumentInput {
  return { kind: 'template', body: BODY, summary: SUMMARY, ...over };
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`report documents repo [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, firstRun);
    let repo: ReportDocumentsRepo;
    let userId: string;

    beforeEach(async () => {
      repo = reportDocumentsRepo(meta());
      userId = (await usersRepo(meta()).create({ email: 'ava@adminium.test', name: 'Ava' })).id;
    });

    async function names(kind: 'template' | 'report'): Promise<string[]> {
      return (await repo.list({ kind })).map((row) => row.name);
    }

    it('create decodes the whole row, defaults the enums, and a first placement prepends', async () => {
      const a = await repo.create(input({ name: 'A', starter: 'exec', createdBy: userId }), T0);
      expect(a).toMatchObject({
        kind: 'template',
        name: 'A',
        status: 'draft',
        starter: 'exec',
        originId: null,
        position: 0,
        createdBy: userId,
        createdAt: T0,
        updatedAt: T0,
      });
      expect(a.id.startsWith('rpt_')).toBe(true);
      // The body round-trips structurally (jsonb reorders keys — compare shapes, not text).
      expect(a.body).toEqual(BODY);
      expect(a.summary).toEqual(SUMMARY);

      const b = await repo.create(input({ name: 'B', status: 'live' }), T0 + 1);
      const c = await repo.create(input({ name: 'C' }), T0 + 2, { at: 'first' });
      expect(b.position).toBe(-1);
      expect(c.position).toBe(-2);
      expect(await names('template')).toEqual(['C', 'B', 'A']);
      expect(await repo.findById('rpt_missing')).toBeNull();
    });

    it('the block array survives the round trip in order, repeats included', async () => {
      const a = await repo.create(input({ name: 'A' }), T0);
      const blocks = (a.body as { blocks: { id: string; kind: string; title: string; w: string; show: boolean }[] }).blocks;
      expect(blocks.map((b) => b.kind)).toEqual(['kpi', 'kpi', 'bar', 'table']);
      expect(blocks.map((b) => b.id)).toEqual(['blk400', 'blk403', 'blk406', 'blk409']);
      expect(blocks[1]).toMatchObject({ w: 'half', show: false });
      expect(blocks[3]?.title).toBe('売上');
    });

    it('a duplicate lands directly after its source, and the rows past it move down', async () => {
      await repo.create(input({ name: 'A' }), T0);
      const b = await repo.create(input({ name: 'B' }), T0 + 1);
      await repo.create(input({ name: 'C' }), T0 + 2);
      // List is C, B, A. A copy of B goes between B and A.
      const copy = await repo.create(input({ name: 'B (copy)' }), T0 + 3, { after: b.id });
      expect(await names('template')).toEqual(['C', 'B', 'B (copy)', 'A']);
      expect(copy.position).toBe(b.position + 1);
      // Positions stay distinct within the kind after the shift.
      const positions = (await repo.list({ kind: 'template' })).map((row) => row.position);
      expect(new Set(positions).size).toBe(positions.length);
      expect(positions).toEqual([...positions].sort((x, y) => x - y));
      // The other kind is untouched by the shift.
      const rep = await repo.create(input({ name: 'R', kind: 'report' }), T0 + 4);
      await repo.create(input({ name: 'B2 (copy)' }), T0 + 5, { after: b.id });
      expect((await repo.findById(rep.id))?.position).toBe(rep.position);
      expect(await names('template')).toEqual(['C', 'B', 'B2 (copy)', 'B (copy)', 'A']);
    });

    it('a source that is gone or of another kind places the copy at the end', async () => {
      const a = await repo.create(input({ name: 'A' }), T0);
      await repo.create(input({ name: 'B' }), T0 + 1);
      const rep = await repo.create(input({ name: 'R', kind: 'report' }), T0 + 2);
      await repo.create(input({ name: 'Orphan' }), T0 + 3, { after: 'rpt_gone' });
      await repo.create(input({ name: 'Cross' }), T0 + 4, { after: rep.id });
      expect(await names('template')).toEqual(['B', 'A', 'Orphan', 'Cross']);
      expect((await repo.findById(a.id))?.position).toBe(0);
    });

    it('counts ignore every filter; list honours the kind', async () => {
      await repo.create(input({ name: 'T1' }), T0);
      await repo.create(input({ name: 'T2' }), T0 + 1);
      await repo.create(input({ name: 'R1', kind: 'report' }), T0 + 2);
      expect(await repo.counts()).toEqual({ template: 2, report: 1 });
      expect((await repo.list({ kind: 'report' })).map((row) => row.name)).toEqual(['R1']);
      // Unfiltered: position first, then id — T1 and R1 tie at 0 and T1's id is older.
      expect((await repo.list()).map((row) => row.name)).toEqual(['T2', 'T1', 'R1']);
    });

    it('patch changes what it is given, re-reads the row, and returns null for a stranger', async () => {
      const row = await repo.create(input({ name: 'Before' }), T0);
      const renamed = await repo.patch(row.id, { name: 'After' }, T0 + 10);
      expect(renamed).toMatchObject({ name: 'After', status: 'draft', updatedAt: T0 + 10 });
      expect(renamed?.body).toEqual(BODY);

      const body = { ...BODY, reportTitle: 'July Business Review', blocks: [] };
      const summary = { ...SUMMARY, reportTitle: 'July Business Review', blockCount: 0, kpiCount: 0, series: [] };
      const saved = await repo.patch(row.id, { status: 'sent', body, summary }, T0 + 20);
      expect(saved).toMatchObject({ name: 'After', status: 'sent', updatedAt: T0 + 20 });
      expect(saved?.body).toEqual(body);
      expect(saved?.summary).toEqual(summary);
      expect(await repo.patch('rpt_missing', { name: 'x' }, T0)).toBeNull();
      // The enums are validated on the way in; `paid` is the INVOICE vocabulary, not this one.
      await expect(repo.patch(row.id, { status: 'paid' as never }, T0)).rejects.toThrow();
      await expect(repo.create(input({ name: 'bad', kind: 'invoice' as never }), T0)).rejects.toThrow();
    });

    it('removeById is a hard delete and answers whether a row went', async () => {
      const a = await repo.create(input({ name: 'A', kind: 'report', originId: 'rpt_TEMPLATE' }), T0);
      expect(a.originId).toBe('rpt_TEMPLATE');
      expect(await repo.removeById(a.id)).toBe(true);
      expect(await repo.removeById(a.id)).toBe(false);
      expect(await repo.findById(a.id)).toBeNull();
      expect(await repo.counts()).toEqual({ template: 0, report: 0 });
    });

    it('a report outlives the template it was built from (the soft origin ref)', async () => {
      const tpl = await repo.create(input({ name: 'Exec template' }), T0);
      const rep = await repo.create(input({ name: 'Q3', kind: 'report', originId: tpl.id }), T0 + 1);
      expect(await repo.removeById(tpl.id)).toBe(true);
      expect((await repo.findById(rep.id))?.originId).toBe(tpl.id);
    });

    it('a deleted creator leaves the row with created_by null (the one FK)', async () => {
      const a = await repo.create(input({ name: 'A', createdBy: userId }), T0);
      await meta().db.deleteFrom('adminium_users').where('id', '=', userId).execute();
      expect((await repo.findById(a.id))?.createdBy).toBeNull();
    });
  });
}
