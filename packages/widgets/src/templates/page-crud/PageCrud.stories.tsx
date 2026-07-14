import { PageCrud } from './PageCrud.js';
import type {
  CrudApi,
  CrudListParams,
  CrudListResult,
  CrudLookupOption,
  CrudReferenceCount,
  CrudRow,
} from './crud-api.js';
import { compareCellValues, demoCustomerColumns, demoCustomerRows, rowIdOf } from '../../families/tables/index.js';

/**
 * Full `page-crud` story over an in-memory CrudApi on demo data
 * (M4-T03 acceptance: template smoke on mock data — create, sort, search,
 * cascade delete and undo all work against local state).
 */
const meta = {
  title: 'Widgets/Templates/PageCrud',
  component: PageCrud,
};
export default meta;

function makeDemoApi(): CrudApi {
  let rows: CrudRow[] = demoCustomerRows(7, 34);
  let deleted: CrudRow[] = [];
  const owners: CrudLookupOption[] = [
    { value: '1', label: 'Ada Lovelace' },
    { value: '2', label: 'Grace Hopper' },
    { value: '3', label: 'Alan Turing' },
    { value: '4', label: 'Edsger Dijkstra' },
  ];
  const referencesFor = (row: CrudRow): CrudReferenceCount[] =>
    Number(row['seats'] ?? 0) > 100
      ? [{ relationId: 'rel_orders', table: 'public.orders', column: 'customer_id', count: Number(row['seats']) % 17 }]
      : [];

  return {
    list: async (params: CrudListParams): Promise<CrudListResult> => {
      let out = [...rows];
      if (params.q !== undefined && params.q !== '') {
        const q = params.q.toLowerCase();
        out = out.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
      }
      const order = params.order?.[0];
      if (order !== undefined) {
        const column = demoCustomerColumns.find((c) => c.name === order.column);
        if (column !== undefined) {
          out.sort((a, b) => compareCellValues(column, a[column.name], b[column.name]) * (order.dir === 'desc' ? -1 : 1));
        }
      }
      if (params.offset !== undefined) {
        return { data: out.slice(0, params.limit ?? 1), page: { limit: params.limit ?? 1, offset: 0, total: out.length } };
      }
      const start = params.cursor === undefined || params.cursor === '' ? 0 : Number(params.cursor);
      const limit = params.limit ?? 50;
      const page = out.slice(start, start + limit);
      const next = start + limit < out.length ? String(start + limit) : null;
      return { data: page, cursor: { next } };
    },
    get: async (recordId) => {
      const row = rows.find((candidate) => rowIdOf(demoCustomerColumns, candidate) === recordId);
      if (row === undefined) throw new Error('Record not found.');
      return { data: row, inboundCounts: referencesFor(row) };
    },
    create: async (values) => {
      const row = { id: rows.length + 1000, is_verified: false, created_at: new Date().toISOString(), ...values };
      rows = [row, ...rows];
      return { data: row, undoToken: `undo_create_${String(row['id'])}` };
    },
    update: async (recordId, patch) => {
      rows = rows.map((row) => (rowIdOf(demoCustomerColumns, row) === recordId ? { ...row, ...patch } : row));
      return { data: rows.find((row) => rowIdOf(demoCustomerColumns, row) === recordId) ?? null, undoToken: 'undo_update' };
    },
    remove: async (recordId, options) => {
      const row = rows.find((candidate) => rowIdOf(demoCustomerColumns, candidate) === recordId);
      if (row === undefined) throw new Error('Record not found.');
      if (options?.dryRun === true) {
        const references = referencesFor(row);
        return { references, requiresConfirm: references.length > 0 };
      }
      deleted = [...deleted, row];
      rows = rows.filter((candidate) => candidate !== row);
      return { data: row, undoToken: `undo_delete_${recordId}` };
    },
    references: async (recordId) => {
      const row = rows.find((candidate) => rowIdOf(demoCustomerColumns, candidate) === recordId);
      return row === undefined ? [] : referencesFor(row);
    },
    undo: async (token) => {
      if (token.startsWith('undo_delete_')) {
        const restored = deleted.at(-1);
        if (restored !== undefined) {
          deleted = deleted.slice(0, -1);
          rows = [restored, ...rows];
          return { restoredIds: [restored['id']] };
        }
      }
      if (token.startsWith('undo_create_')) {
        const id = Number(token.slice('undo_create_'.length));
        rows = rows.filter((row) => row['id'] !== id);
        return { restoredIds: [id] };
      }
      return { restoredIds: [] };
    },
    bulk: async (action, ids) => {
      if (action === 'delete') {
        const idSet = new Set(ids.map(String));
        const removed = rows.filter((row) => idSet.has(rowIdOf(demoCustomerColumns, row)));
        deleted = [...deleted, ...removed];
        rows = rows.filter((row) => !idSet.has(rowIdOf(demoCustomerColumns, row)));
        return { results: removed.map((row) => ({ id: row['id'], ok: true })), undoToken: 'undo_delete_bulk' };
      }
      return { results: [], undoToken: null };
    },
    lookup: async (_fk, query) =>
      owners.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase())),
  };
}

export const CustomersTable = {
  render: () => (
    <div className="h-[640px] p-4">
      <PageCrud
        api={makeDemoApi()}
        columns={demoCustomerColumns}
        source={{ connectionId: 'conn_demo', table: 'public.customers' }}
        pageSize={25}
        defaultSort={{ column: 'created_at', dir: 'desc' }}
        canUnmask
      />
    </div>
  ),
};

export const ReadOnlyRole = {
  render: () => (
    <div className="h-[640px] p-4">
      <PageCrud
        api={makeDemoApi()}
        columns={demoCustomerColumns}
        source={{ connectionId: 'conn_demo', table: 'public.customers' }}
        canCreate={false}
        canUpdate={false}
        canDelete={false}
      />
    </div>
  ),
};
