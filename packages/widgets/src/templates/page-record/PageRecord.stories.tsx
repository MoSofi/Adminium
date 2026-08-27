// SPDX-License-Identifier: AGPL-3.0-only
import { PageRecord } from './PageRecord.js';
import type { PageRecordRelated, RecordActivityFeed } from './PageRecord.js';
import type { CrudApi, CrudReferenceCount, CrudRow } from '../page-crud/crud-api.js';
import { demoCustomerColumns, demoCustomerRows } from '../../families/tables/index.js';

/**
 * `page-record` stories over an in-memory CrudApi (30-record-pages.md D4):
 * the key-field hero, field grid, related-record tabs with count pills, and
 * the per-record activity timeline — plus the readOnly and no-page
 * degradations the parity criteria pin (30 D5/D7).
 */
const meta = {
  title: 'Widgets/Templates/PageRecord',
  component: PageRecord,
};
export default meta;

const DEMO_EPOCH = 1_750_000_000_000;

const record: CrudRow = { ...demoCustomerRows(7, 34)[0], id: 1 };

const relatedRows: CrudRow[] = Array.from({ length: 14 }, (_, index) => ({
  order_id: 5100 + index,
  customer_id: 1,
  status: index % 3 === 0 ? 'pending' : 'shipped',
  total: String(120 + index * 35),
}));

const REFERENCES: CrudReferenceCount[] = [
  { relationId: 'rel_orders', table: 'public.orders', column: 'customer_id', count: relatedRows.length },
];

function makeApi(): CrudApi {
  return {
    list: async () => ({ data: [record], cursor: { next: null } }),
    get: async () => ({ data: record, inboundCounts: REFERENCES }),
    create: async () => ({ data: null, undoToken: null }),
    update: async () => ({ data: null, undoToken: 'undo_demo' }),
    remove: async (_id, options) =>
      options?.dryRun === true
        ? { references: REFERENCES, requiresConfirm: true }
        : { data: null, undoToken: 'undo_demo' },
    references: async () => REFERENCES,
    undo: async () => ({ restoredIds: [1] }),
  };
}

const related: PageRecordRelated = {
  list: async (_table, params) => {
    const start = params.cursor === undefined || params.cursor === '' ? 0 : Number(params.cursor);
    const limit = params.limit ?? 10;
    const page = relatedRows.slice(start, start + limit);
    return {
      data: page,
      cursor: { next: start + limit < relatedRows.length ? String(start + limit) : null },
    };
  },
  resolve: async () => null,
  linkable: () => false,
};

const activity: RecordActivityFeed = {
  list: async () => ({
    entries: [
      { id: 'aud_3', actorLabel: 'Ada Lovelace', action: 'record.update', at: DEMO_EPOCH - 3_600_000, changedFields: 2 },
      { id: 'aud_2', actorLabel: 'Grace Hopper', action: 'record.update', at: DEMO_EPOCH - 86_400_000, changedFields: 1 },
      { id: 'aud_1', actorLabel: 'Ada Lovelace', action: 'record.create', at: DEMO_EPOCH - 604_800_000 },
    ],
    nextCursor: null,
  }),
};

const tabs = [{ table: 'public.orders', fkColumn: 'customer_id', label: 'Orders' }];

export const RecordPage = {
  render: () => (
    <PageRecord
      api={makeApi()}
      columns={demoCustomerColumns}
      source={{ connectionId: 'conn_demo', table: 'public.customers' }}
      recordId="1"
      keyField="name"
      tabs={tabs}
      related={related}
      activity={activity}
    />
  ),
};

export const ReadOnly = {
  name: 'Read-only (no write affordance, 30 D7)',
  render: () => (
    <PageRecord
      api={makeApi()}
      columns={demoCustomerColumns}
      source={{ connectionId: 'conn_demo', table: 'public.customers' }}
      recordId="1"
      keyField="name"
      readOnly
      tabs={tabs}
      related={related}
    />
  ),
};

export const NoTabs = {
  name: 'Fields only (no inbound FKs, no activity grant)',
  render: () => (
    <PageRecord
      api={makeApi()}
      columns={demoCustomerColumns}
      source={{ connectionId: 'conn_demo', table: 'public.customers' }}
      recordId="1"
      keyField="name"
    />
  ),
};
