// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A RECORDS PAGE SAYS OF ITSELF REACHES THE STORED PAGE.
 *
 * A manifest's page may name the list's filters and the filters it opens
 * with, word its related tabs, and declare bulk actions. An install used to
 * check those keys and drop them. They are bound to the real tables and
 * written with the page — before it is stamped, so a fresh page still reads
 * as nobody's edit — and a key that does not fit is a warning with the page
 * still written.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { bindListConfig } from '../src/apps/manifest-page-config.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { isUntouched } from '../src/pages/generated-stamp.js';
import { BULK, DESK } from '../../../packages/manifest/test/desk-fixture.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a stored page read freely
type Doc = Record<string, any>;

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

async function installed(change?: (doc: Doc) => void): Promise<{ config: Doc; envelope: Doc; reply: Doc }> {
  h = await addOnHarness('sqlite', { unbuiltWords: {} });
  const doc = structuredClone(DESK) as Doc;
  change?.(doc);
  await h.stageAddOn(doc, { bundled: true, files: { 'pages/look-up.js': 'export default function Page() { return null; }' } });
  const reply = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'desk', version: '1.0.0', attachTo: [] } });
  expect(reply.statusCode, reply.body).toBe(200);
  const row = await h.meta.db.selectFrom('adminium_pages').select('config').where('slug', '=', 'desk-cards').executeTakeFirstOrThrow();
  const envelope = (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) as Doc;
  return { config: envelope['config'] as Doc, envelope, reply: reply.json() as Doc };
}
const idOf = async (ref: string): Promise<string> => {
  const model = (await (await import('@adminium/meta')).snapshotsRepo(h!.meta).latest(h!.connectionId))!.schema as { tables: { id: string; name: string }[] };
  return model.tables.find((table) => table.name === `desk_${ref}`)!.id;
};

describe('a manifest\'s list config reaches the stored page', () => {
  it('the filters, in the order written, each with its control and one label', async () => {
    const { config } = await installed();
    expect(config['filters']).toEqual([{ column: 'status', control: 'any-of', label: 'State' }, { column: 'kind' }, { column: 'activated_at' }, { column: 'balance', control: 'number-range' }]);
  });

  it('the filters a list opens with are written too, where they were only checked before', async () => {
    const { config } = await installed((doc) => {
      doc.pages[0].config.defaultFilters = [{ column: 'status', op: 'eq', value: 'active' }];
    });
    expect(config['defaultFilters']).toEqual([{ column: 'status', op: 'eq', value: 'active' }]);
  });

  it('a tab\'s words reach the tab the generator made for that child table: its title and body by language, and no New row', async () => {
    const { config } = await installed();
    const tab = (config['detail'].tabs as Doc[]).find((candidate) => candidate['table'].endsWith('desk_card_actions'))!;
    expect(tab['table']).toBe(await idOf('card_actions'));
    expect(tab['empty']).toEqual({ title: 'Nothing done yet', body: 'A top up shows here.', bodies: { en_US: 'A top up shows here.' } });
    expect(tab['noNew']).toBe(true);
    // What the generator wrote of the tab is still there.
    expect(tab['fkColumn']).toBe('card_id');
  });

  it('a bulk action is stored with its child table by its real id and its words by language', async () => {
    const { config } = await installed();
    expect(config['bulk']).toEqual([
      {
        id: 'reissue',
        label: 'Reissue',
        child: { table: await idOf('card_actions'), via: 'card_id', form: ['note'] },
        set: { action: 'reissue' },
        where: { column: 'status', eq: 'active' },
        confirm: { title: 'Reissue {count} cards?', body: 'Each of the {count} gets a new action.', bodies: { en_US: 'Each of the {count} gets a new action.' }, columns: ['label', 'balance'] },
        done: '{count} reissued',
      },
    ]);
    expect(BULK.child.table).toBe('card_actions');
  });

  it('a fresh page with all of them still reads as nobody\'s edit', async () => {
    const { envelope } = await installed();
    expect(isUntouched(envelope)).toBe(true);
  });

  it('a code only its last four are shown of, and a code staff never see, are on no list', async () => {
    const { config } = await installed();
    const columns = (config['columns'] as { name: string }[]).map((column) => column.name);
    expect(columns).toContain('status');
    expect(columns).toContain('label');
    // `label` keeps the last four of `code`; `pin` is hidden from staff.
    expect(columns).not.toContain('code');
    expect(columns).not.toContain('pin');
  });

  it('a tab the page does not have, and an action over a table that is not here, are warnings — the rest is still bound', async () => {
    await installed();
    const view = await loadSnapshotView(h!.meta, h!.connectionId);
    const cards = view.table(await idOf('cards'));
    const names = { cards: 'desk_cards', card_actions: 'desk_card_actions', words: 'desk_words' };
    const raw = {
      filters: [{ column: 'status' }],
      // The page was generated with no tab over `words` (it has no link to cards).
      tabs: { words: { empty: 'None' }, card_actions: { noNew: true } },
      bulk: [{ ...BULK, child: { ...BULK.child, table: 'gone' } }],
    };
    const bound = bindListConfig(raw, view, cards, names, { detail: { tabs: [{ table: await idOf('card_actions'), fkColumn: 'card_id' }] } });
    expect(bound.warnings.map((warning) => warning.reason)).toEqual(['PAGE_TAB_UNKNOWN', 'PAGE_BULK_INVALID']);
    expect(bound.config['filters']).toEqual([{ column: 'status' }]);
    expect((bound.config['detail'] as Doc).tabs).toEqual([{ table: await idOf('card_actions'), fkColumn: 'card_id', noNew: true }]);
    expect(bound.config).not.toHaveProperty('bulk');
    // A filter over a column the table has not: nothing written for it, and said.
    const off = bindListConfig({ filters: [{ column: 'ghost' }], defaultFilters: [{ column: 'ghost', op: 'eq', value: 1 }] }, view, cards, names, {});
    expect(off.warnings.map((warning) => warning.reason)).toEqual(['PAGE_FILTERS_INVALID', 'PAGE_DEFAULT_FILTERS_INVALID']);
    expect(off.config).toEqual({});
  });

  it('a page with none of these keys is written as it always was', async () => {
    const { config } = await installed((doc) => {
      delete doc.pages[0].config;
    });
    for (const key of ['filters', 'defaultFilters', 'bulk']) expect(config, key).not.toHaveProperty(key);
    const tab = (config['detail'].tabs as Doc[]).find((candidate) => candidate['table'].endsWith('desk_card_actions'))!;
    expect(tab).not.toHaveProperty('empty');
    expect(tab).not.toHaveProperty('noNew');
  });
});
