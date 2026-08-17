// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Button, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { CrudApi, CrudGetResult, CrudReferenceCount, CrudRow } from './crud-api.js';
import { DetailKeyValue } from '../../families/tables/DetailKeyValue.js';
import { MiniTable } from '../../families/tables/MiniTable.js';
import type { CellContext } from '../../families/tables/cells.js';
import { displayValueOf } from '../../families/tables/column-spec.js';
import type { GridColumnSpec } from '../../families/tables/column-spec.js';

/**
 * RecordDetail — the `/p/$slug/r/$recordId` panel body (09 §7.1): key-field
 * headline, `detail-key-value` fields, tabs generated from inbound FKs with
 * live count pills; each tab lists related records through
 * `CrudApi.listRelated` when the host provides it (counts only otherwise).
 */

export interface RecordDetailProps {
  api: CrudApi;
  columns: readonly GridColumnSpec[];
  recordId: string;
  cellContext?: CellContext | undefined;
  onEdit?: ((record: CrudRow) => void) | undefined;
  onDelete?: ((record: CrudRow) => void) | undefined;
  labels?: { edit?: string | undefined; delete?: string | undefined; fields?: string | undefined } | undefined;
}

function RelatedTab({
  api,
  reference,
  pkValue,
}: {
  api: CrudApi;
  reference: CrudReferenceCount;
  /** This record's PK — the reference rows point at it. */
  pkValue: unknown;
}) {
  const t = useMaybeT();
  const [rows, setRows] = useState<CrudRow[] | null>(null);
  const listRelated = api.listRelated?.bind(api);
  useEffect(() => {
    if (listRelated === undefined) return;
    let alive = true;
    void listRelated({ table: reference.table, column: reference.column, value: pkValue, limit: 6 }).then((loaded) => {
      if (alive) setRows(loaded);
    });
    return () => {
      alive = false;
    };
  }, [listRelated, reference.table, reference.column, pkValue]);

  if (listRelated === undefined || rows === null) {
    return (
      <p className="px-1 py-3 text-body-sm text-fg-muted">
        {/* `count` drives the ICU plural; `n` keeps the digits byte-identical. */}
        {t(
          'ui:templates.crud.detail.relatedCount',
          '{count, plural, one {{n} related record in {table}} other {{n} related records in {table}}}',
          { count: reference.count, n: String(reference.count), table: reference.table },
        )}
      </p>
    );
  }
  const columns: GridColumnSpec[] = Object.keys(rows[0] ?? {})
    .filter((key) => key !== '_masked')
    .slice(0, 3)
    .map((key, index) => ({
      name: key,
      label: key,
      logicalType: 'text',
      semantic: null,
      format: null,
      pii: false,
      mono: index > 0,
      sortable: false,
      hidden: false,
      primaryKey: index === 0,
      nullable: true,
      hasDefault: false,
      unique: false,
      readOnly: true,
      maxLength: null,
      isDisplay: false,
    }));
  return <MiniTable columns={columns} rows={rows} limit={6} />;
}

export function RecordDetail({
  api,
  columns,
  recordId,
  cellContext,
  onEdit,
  onDelete,
  labels,
}: RecordDetailProps) {
  const t = useMaybeT();
  const [result, setResult] = useState<CrudGetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setResult(null);
    setError(null);
    api
      .get(recordId, { include: 'inboundCounts' })
      .then((loaded) => {
        if (alive) setResult(loaded);
      })
      .catch((reason: unknown) => {
        if (alive) {
          setError(
            reason instanceof Error ? reason.message : t('ui:templates.crud.detail.loadError', 'Failed to load the record.'),
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [api, recordId]);

  if (error !== null) {
    return (
      <p role="alert" className="px-1 py-6 text-body-sm text-danger">
        {error}
      </p>
    );
  }
  if (result === null) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner label={t('ui:templates.common.loadingRecord', 'Loading record')} />
      </div>
    );
  }

  const record = result.data;
  const references = result.inboundCounts ?? [];
  const title = displayValueOf(columns, record);

  return (
    <div data-part="record-detail" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        {/* Key-field highlight (09 §8.3). */}
        <h3 className="truncate text-h3 text-fg">{title}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {onEdit !== undefined && (
            <Button size="sm" variant="secondary" iconLeft={<Pencil />} onClick={() => onEdit(record)}>
              {labels?.edit ?? t('ui:action.edit', 'Edit')}
            </Button>
          )}
          {onDelete !== undefined && (
            <Button size="sm" variant="destructive" iconLeft={<Trash2 />} onClick={() => onDelete(record)}>
              {labels?.delete ?? t('ui:action.delete', 'Delete')}
            </Button>
          )}
        </div>
      </div>

      {references.length === 0 ? (
        <DetailKeyValue columns={columns} record={record} cellContext={cellContext} showTypeTags />
      ) : (
        <Tabs defaultValue="__fields">
          <TabsList>
            <TabsTrigger value="__fields">{labels?.fields ?? t('ui:templates.crud.detail.fields', 'Fields')}</TabsTrigger>
            {references.map((reference) => (
              <TabsTrigger key={reference.relationId} value={reference.relationId} count={reference.count}>
                {reference.table.split('.').pop()}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="__fields">
            <DetailKeyValue columns={columns} record={record} cellContext={cellContext} showTypeTags />
          </TabsContent>
          {references.map((reference) => (
            <TabsContent key={reference.relationId} value={reference.relationId}>
              <RelatedTab api={api} reference={reference} pkValue={pkValueOf(columns, record)} />
            </TabsContent>
          ))}
        </Tabs>
      )}

      {references.length > 0 && (
        <p className="text-caption text-fg-muted">
          <Badge tone="info">{references.reduce((sum, r) => sum + r.count, 0)}</Badge>{' '}
          {t('ui:templates.crud.detail.inboundReferences', 'inbound references')}
        </p>
      )}
    </div>
  );
}

function pkValueOf(columns: readonly GridColumnSpec[], record: CrudRow): unknown {
  const pk = columns.find((column) => column.primaryKey);
  return pk === undefined ? null : record[pk.name];
}
