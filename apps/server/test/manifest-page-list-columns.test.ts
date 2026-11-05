// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE COLUMNS A LIST OPENS ON, AS THE APP NAMES THEM.
 *
 * Left to itself the generator ranks a table's columns and keeps eight, and
 * on a table of rate-card prices the prices win: a print shop's Jobs list
 * opened on money with no order, product or stage. An app's `page-crud` page
 * may name the columns its list opens on (`config.columns`); the install
 * writes those first, in that order, shown, and every other column of the
 * table after them, hidden, so the page's column settings still offer each
 * one. A column kept from staff, or a secret, is on no list either way. On every engine
 * this run can reach.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { bindListConfig } from '../src/apps/manifest-page-config.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { isUntouched } from '../src/pages/generated-stamp.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
interface Spec {
  name: string;
  hidden?: boolean;
  label?: string;
}

const pk = { ref: 'id', type: 'int', role: 'pk' } as const;
const money = (ref: string) => ({ ref, type: 'decimal', scale: 2, nullable: true });
const OPENS_ON = ['order_id', 'product_name', 'stage', 'ready_by', 'proof_state'];

function printShop(columns: unknown): Doc {
  return {
    manifestVersion: 1,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    kind: 'app',
    key: 'printing',
    name: 'Print shop',
    version: '1.0.0',
    description: { key: 'mft.printing.desc', fallback: 'A shop.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.47', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'orders', keyField: 'number', columns: [pk, { ref: 'number', type: 'text', maxLength: 16 }] },
        {
          ref: 'jobs',
          columns: [
            pk,
            // Rate-card prices first: what the generator ranks highest.
            money('unit_price'),
            money('setup_price'),
            money('finish_price'),
            money('line_total'),
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'product_name', type: 'text', maxLength: 80, nullable: true },
            { ref: 'stage', type: 'enum', enum: ['prepress', 'press', 'finishing', 'done'], default: 'prepress' },
            { ref: 'ready_by', type: 'date', nullable: true },
            { ref: 'proof_state', type: 'enum', enum: ['none', 'sent', 'approved'], default: 'none' },
            { ref: 'quantity', type: 'int', default: 1 },
            { ref: 'note', type: 'text', maxLength: 200, nullable: true },
            // A secret by its name alone (the database's reading, not the manifest's): never listed, hidden or not.
            { ref: 'password_hash', type: 'text', maxLength: 100, nullable: true },
            // A code staff never see: on no list, named or not.
            { ref: 'pickup_code', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 8, hiddenFromStaff: true } } },
          ],
        },
      ],
    },
    pages: [
      {
        ref: 'printing-jobs',
        template: 'page-crud',
        title: { key: 'mft.printing.page.jobs', fallback: 'Jobs' },
        nav: { group: 'manifest:sample', icon: 'list', order: 1 },
        bindings: { main: 'jobs' },
        ...(columns === undefined ? {} : { config: { columns } }),
      },
    ],
    frontends: [{ side: 'staff', kind: 'none' }],
  };
}

describe.each(LEGS)('the columns a list opens on — %s', (dialect, available) => {
  let h: Harness | null = null;
  afterEach(async () => {
    await h?.close();
    h = null;
  });

  async function installed(columns: unknown): Promise<{ specs: Spec[]; envelope: Doc }> {
    h = await addOnHarness(dialect);
    await h.stageApp(printShop(columns));
    const reply = await h.install('printing', '1.0.0');
    expect(reply.statusCode, reply.body).toBe(200);
    const row = await h.meta.db.selectFrom('adminium_pages').select('config').where('slug', '=', 'printing-jobs').executeTakeFirstOrThrow();
    const envelope = (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) as Doc;
    return { specs: ((envelope['config'] as Doc)['columns'] ?? []) as Spec[], envelope };
  }
  const shown = (specs: readonly Spec[]) => specs.filter((spec) => spec.hidden !== true).map((spec) => spec.name);

  it.skipIf(!available)('opens on the columns the app names, in its order; every other column is there, hidden, to switch on', async () => {
    const { specs, envelope } = await installed(OPENS_ON);
    expect(shown(specs)).toEqual(OPENS_ON);
    const hidden = specs.filter((spec) => spec.hidden === true).map((spec) => spec.name);
    expect(hidden).toEqual(expect.arrayContaining(['id', 'unit_price', 'setup_price', 'finish_price', 'line_total', 'quantity', 'note']));
    // Each column of the table once, and the code staff never see on none.
    expect(new Set(specs.map((spec) => spec.name)).size).toBe(specs.length);
    expect(specs.map((spec) => spec.name)).not.toContain('pickup_code');
    expect(specs.map((spec) => spec.name)).not.toContain('password_hash');
    // A named column the generator also ranked keeps the spec it wrote (its link to the order).
    expect(specs.find((spec) => spec.name === 'order_id')).toMatchObject({ name: 'order_id', hidden: false });
    expect(isUntouched(envelope)).toBe(true);
  });

  it.skipIf(!available)('without them, the list opens on what the generator ranks: the prices first', async () => {
    const { specs } = await installed(undefined);
    expect(shown(specs).slice(0, OPENS_ON.length)).not.toEqual(OPENS_ON);
    expect(shown(specs)).toEqual(expect.arrayContaining(['unit_price']));
  });

  it.skipIf(!available)('a column the table does not have is a warning, and the list opens on what Adminium picks', async () => {
    await installed(undefined);
    const view = await loadSnapshotView(h!.meta, h!.connectionId);
    const jobs = view.table(view.model.tables.find((table) => table.name === 'printing_jobs')!.id);
    const off = bindListConfig({ columns: ['stage', 'ghost'] }, view, jobs, { jobs: 'printing_jobs' }, {});
    expect(off.warnings.map((warning) => warning.reason)).toEqual(['PAGE_COLUMNS_INVALID']);
    expect(off.config).not.toHaveProperty('columns');
    const bad = bindListConfig({ columns: 'stage' }, view, jobs, { jobs: 'printing_jobs' }, {});
    expect(bad.warnings.map((warning) => warning.reason)).toEqual(['PAGE_COLUMNS_INVALID']);
  });
});
