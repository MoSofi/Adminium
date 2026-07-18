/**
 * PlanningRecordDrawer — the `/p/$slug/r/$recordId` drawer for the planning
 * archetype pages (09-generated-app.md §2.3; the `page-crud` detail pattern).
 *
 * Archetype envelopes carry no `columns[]` config, so the drawer derives a
 * read-only `GridColumnSpec[]` from the fetched record's own keys (the
 * RecordDetail RelatedTab convention) and reuses the page-crud `RecordDetail`
 * body — key-field headline, detail-key-value fields, inbound-FK tabs.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Button, Drawer, DrawerBody, DrawerHeader, EmptyState, Spinner } from '@adminium/ui';
import { RecordDetail, type GridColumnSpec } from '@adminium/widgets';

import type { BoundCrudApi } from '../../api/crud.js';
import { t } from '../../i18n/t.js';

/** `public.customers` → `customer` (PageCrud's entity framing). */
function entityFromTable(table: string): string {
  const name = table.split('.').pop() ?? table;
  return name.endsWith('s') ? name.slice(0, -1) : name;
}

/** Read-only column specs derived from the record's keys. */
function columnsFromRecord(record: Record<string, unknown>): GridColumnSpec[] {
  const keys = Object.keys(record).filter((key) => key !== '_masked');
  const pk = keys.includes('id') ? 'id' : keys[0];
  return keys.map((key) => ({
    name: key,
    label: key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
    logicalType: 'text',
    semantic: null,
    format: null,
    pii: false,
    mono: key === pk,
    sortable: false,
    hidden: false,
    primaryKey: key === pk,
    nullable: true,
    hasDefault: false,
    unique: false,
    readOnly: true,
    maxLength: null,
    isDisplay: key === 'title' || key === 'name',
  }));
}

export interface PlanningRecordDrawerProps {
  crud: BoundCrudApi;
  recordId: string;
  onClose: () => void;
}

export function PlanningRecordDrawer({ crud, recordId, onClose }: PlanningRecordDrawerProps) {
  const record = useQuery({
    queryKey: ['data', crud.connectionId, crud.table, 'planning-record', recordId] as const,
    staleTime: 0,
    queryFn: () => crud.get(recordId),
  });

  const columns = useMemo(
    () => (record.data === undefined ? [] : columnsFromRecord(record.data.data)),
    [record.data],
  );

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()} size="md">
      <DrawerHeader
        title={entityFromTable(crud.table)}
        closeLabel={t('planning.drawer.close', 'Close')}
      />
      <DrawerBody>
        {record.isPending ? (
          <div className="flex items-center justify-center py-16">
            <Spinner label={t('planning.drawer.loading', 'Loading record')} />
          </div>
        ) : record.isError ? (
          <EmptyState
            tone="danger"
            title={t('planning.drawer.error', 'Could not load this record.')}
            body={record.error instanceof Error ? record.error.message : undefined}
            actions={
              <Button size="sm" variant="secondary" onClick={() => void record.refetch()}>
                {t('common.retry', 'Retry')}
              </Button>
            }
          />
        ) : (
          <RecordDetail api={crud} columns={columns} recordId={recordId} />
        )}
      </DrawerBody>
    </Drawer>
  );
}
