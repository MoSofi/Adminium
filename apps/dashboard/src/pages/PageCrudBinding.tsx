/**
 * `page-crud` binding (09-generated-app.md §4.1, §7.1): projects the page
 * envelope onto the real `PageCrud` template from `@adminium/widgets` —
 * `config.columns[]` → validated `GridColumnSpec[]` (invalid entries are
 * dropped with a console warning, never a crash), the bound `CrudApi`
 * adapter, route-controlled detail record, and the host WidgetEvent sink.
 */
import { useMemo } from 'react';
import { PageCrud, gridColumnSpecSchema, type GridColumnSpec } from '@adminium/widgets';

import type { PageTemplateProps } from './template-types.js';

function parseColumns(config: Record<string, unknown>, pageId: string): GridColumnSpec[] {
  const raw = config['columns'];
  if (!Array.isArray(raw)) return [];
  const columns: GridColumnSpec[] = [];
  for (const entry of raw) {
    const parsed = gridColumnSpecSchema.safeParse(entry);
    if (parsed.success) {
      columns.push(parsed.data);
    } else {
      console.warn(`[adminium] ${pageId}: dropping invalid column spec`, parsed.error.issues[0]?.message);
    }
  }
  return columns;
}

export function PageCrudBinding({ page, adapters, recordId }: PageTemplateProps) {
  const crud = adapters.crud;
  const columns = useMemo(() => parseColumns(page.config, page.id), [page.config, page.id]);
  if (crud === null) {
    // Bad generation output (page-crud without a source) — caught by the
    // PageRenderer error boundary and rendered as the page error card.
    throw new Error(`page-crud document ${page.id} has no source table`);
  }
  return (
    <PageCrud
      api={crud}
      columns={columns}
      source={{ connectionId: page.source.connectionId, table: page.source.table ?? crud.table }}
      detailRecordId={recordId ?? null}
      onDetailRecordChange={adapters.openRecord}
      onEvent={adapters.onEvent}
    />
  );
}
