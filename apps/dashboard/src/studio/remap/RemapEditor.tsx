// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Schema remap editor (M5-T04; research/ia-mapping.md §4 "remapped
 * public.customers"): two-pane Studio surface over the connection's active
 * snapshot.
 *
 * - Left: schema tree (search, per-table columns, type chips, PK/FK/UNIQUE/
 *   PII badges) rendering the APPLIED model from `GET /connections/:id/schema`
 *   — after a save the queries refetch and the applied labels show up inline,
 *   proving the server-side read path.
 * - Right: inspector for the selection (table / column) + Relations tab.
 * - Bottom: diff bar over the local edit buffer; Save = full-document
 *   `PUT /connections/:id/overrides`; 422 issues map back to the offending
 *   change chip and inspector field.
 * - Post-save: "Regenerate pages" (POST /connections/:id/generate) with
 *   created/updated/unchanged counts; user-edited pages are preserved via
 *   generated_hash semantics (04-widget-registry.md §6.3).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Banner,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToastStack,
  useToastQueue,
} from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { capabilityNotes, modelCapabilitySource } from '../connect/capabilityNotes.js';
import { ColumnInspector } from './ColumnInspector.js';
import { DiffBar } from './DiffBar.js';
import { RelationsTab } from './RelationsTab.js';
import { SchemaTree } from './SchemaTree.js';
import { TableInspector } from './TableInspector.js';
import { putOverrides, regeneratePages, remapOverridesQuery, remapSchemaQuery } from './api.js';
import { tableById, type RemapSelection } from './model.js';
import { overrideKey, type RemapOverride } from './overrides.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { useRemapBuffer } from './useRemapBuffer.js';

export interface RemapEditorProps {
  connectionId: string;
}

interface SaveError {
  message: string;
  /** Change key the server rejected, when the 422 details identify one. */
  key: string | null;
  /** Table/column the failure targets (drives the inspector field error). */
  tableName: string | null;
  columnName: string | null;
}

/** Map a 422 `ValidationFailedError` envelope back onto buffer targets. */
function toSaveError(error: ApiError): SaveError {
  const details = (error.details ?? {}) as {
    item?: { op?: string; tableName?: string; columnName?: string | null; value?: Record<string, unknown> };
    table?: string;
    column?: string;
  };
  const item = details.item;
  let key: string | null = null;
  if (item !== undefined && typeof item.op === 'string' && typeof item.tableName === 'string') {
    key = overrideKey({
      op: item.op,
      tableName: item.tableName,
      ...(typeof item.columnName === 'string' ? { columnName: item.columnName } : {}),
      value: item.value ?? {},
    } as RemapOverride);
  }
  return {
    message: error.message,
    key,
    tableName: item?.tableName ?? details.table ?? null,
    columnName: (typeof item?.columnName === 'string' ? item.columnName : null) ?? details.column ?? null,
  };
}

export function RemapEditor({ connectionId }: RemapEditorProps) {
  const queryClient = useQueryClient();
  const schemaQuery = useQuery(remapSchemaQuery(connectionId));
  const overridesQuery = useQuery(remapOverridesQuery(connectionId));
  const buffer = useRemapBuffer(overridesQuery.data?.overrides);
  const toasts = useToastQueue();

  const [selection, setSelection] = useState<RemapSelection | null>(null);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [saveError, setSaveError] = useState<SaveError | null>(null);

  const model = schemaQuery.data?.model;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await putOverrides(connectionId, buffer.buildDocument());
      buffer.clear();
      setSavedOnce(true);
      toasts.push({
        variant: 'success',
        title: t('studio:remap.toast.saved', 'Schema overrides saved'),
        description: t('studio:remap.toast.savedDetail', 'The applied schema below reflects your changes.'),
      });
      // Live-preview read path: refetch the APPLIED schema + persisted rows.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: remapSchemaQuery(connectionId).queryKey }),
        queryClient.invalidateQueries({ queryKey: remapOverridesQuery(connectionId).queryKey }),
      ]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setSaveError(toSaveError(error));
      } else {
        setSaveError({
          message: error instanceof Error ? error.message : String(error),
          key: null,
          tableName: null,
          columnName: null,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const reply = await regeneratePages(connectionId);
      toasts.push({
        variant: 'success',
        title: t('studio:remap.toast.regenerated', '{created} created · {updated} updated · {unchanged} unchanged', { created: String(reply.result.created), updated: String(reply.result.updated), unchanged: String(reply.result.unchanged) }),
        description: t(
          'studio:remap.toast.regeneratedDetail',
          'Pages you edited by hand are preserved — only pages with an untouched generated_hash were regenerated in place.',
        ),
      });
    } catch (error) {
      toasts.push({
        variant: 'error',
        title: t('studio:remap.toast.regenerateFailed', 'Regeneration failed'),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setRegenerating(false);
    }
  };

  const fieldErrorFor = (tableName: string, columnName: string | null): string | undefined =>
    saveError !== null && saveError.tableName === tableName && saveError.columnName === columnName
      ? saveError.message
      : undefined;

  const selectedTable =
    model !== undefined && selection !== null ? tableById(model, selection.tableId) : undefined;
  const selectedColumn =
    selection?.kind === 'column' && selectedTable !== undefined
      ? selectedTable.columns.find((column) => column.name === selection.column)
      : undefined;

  // Per-engine capability notes (M9-T04): what this source could not express,
  // so remapping expectations stay honest (e.g. SQLite has no comments to
  // import — labels set here are the labeling path).
  const sourceNotes = model === undefined ? [] : capabilityNotes(modelCapabilitySource(model));

  return (
    <PageSurface fill className="gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-section text-fg">{t('studio:remap.title', 'Schema remap')}</h2>
        {schemaQuery.data !== undefined ? (
          <span className="text-body-sm text-fg-muted">
            {t('studio:remap.subtitle', '{tables} tables · {applied} overrides applied', { tables: String(schemaQuery.data.model.tables.length), applied: String(schemaQuery.data.appliedOverrides) })}
          </span>
        ) : null}
      </header>

      {sourceNotes.length > 0 ? (
        <Banner tone="info">
          <span className="flex flex-col gap-0.5">
            {sourceNotes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </span>
        </Banner>
      ) : null}

      {saveError !== null ? (
        <Banner tone="danger" role="alert">
          {t('studio:remap.saveFailed', 'Save failed: {message}', { message: saveError.message })}
        </Banner>
      ) : null}
      {schemaQuery.isError ? (
        <Banner tone="danger" role="alert">
          {t('studio:remap.loadFailed', 'Could not load the schema for this connection.')}
        </Banner>
      ) : null}

      {schemaQuery.isPending || overridesQuery.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {model !== undefined ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[minmax(16rem,22rem)_1fr]">
          <SchemaTree model={model} buffer={buffer} selection={selection} onSelect={setSelection} />
          <section
            aria-label={t('studio:remap.inspector', 'Inspector')}
            className="min-h-0 overflow-y-auto rounded-lg border border-border bg-surface p-4"
          >
            {selection === null || selectedTable === undefined ? (
              <EmptyState
                preset="no-data"
                title={t('studio:remap.empty.title', 'Pick a table or column')}
                body={t(
                  'studio:remap.empty.description',
                  'Select something in the schema tree to remap its label, type, relations or masking.',
                )}
              />
            ) : selection.kind === 'column' && selectedColumn !== undefined ? (
              <ColumnInspector
                model={model}
                table={selectedTable}
                column={selectedColumn}
                buffer={buffer}
                fieldError={fieldErrorFor(selectedTable.id, selectedColumn.name)}
              />
            ) : (
              <Tabs defaultValue="details">
                <TabsList>
                  <TabsTrigger value="details">{t('studio:remap.tabs.details', 'Details')}</TabsTrigger>
                  <TabsTrigger value="relations">{t('studio:remap.tabs.relations', 'Relations')}</TabsTrigger>
                </TabsList>
                <TabsContent value="details" className="pt-4">
                  <TableInspector
                    table={selectedTable}
                    buffer={buffer}
                    fieldError={fieldErrorFor(selectedTable.id, null)}
                  />
                </TabsContent>
                <TabsContent value="relations" className="pt-4">
                  <RelationsTab model={model} table={selectedTable} buffer={buffer} />
                </TabsContent>
              </Tabs>
            )}
          </section>
        </div>
      ) : null}

      <DiffBar
        changes={buffer.changes}
        onRevert={buffer.revert}
        onRevertAll={buffer.revertAll}
        onSave={() => void handleSave()}
        saving={saving}
        errorKey={saveError?.key ?? null}
        canRegenerate={savedOnce}
        onRegenerate={() => void handleRegenerate()}
        regenerating={regenerating}
      />

      <ToastStack
        {...toasts.stackProps}
        dismissLabel={t('common.dismiss', 'Dismiss')}
        label={t('common.notifications', 'Notifications')}
      />
    </PageSurface>
  );
}
