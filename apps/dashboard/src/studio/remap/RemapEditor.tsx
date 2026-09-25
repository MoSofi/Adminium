// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Schema remap editor: two-pane Studio surface over the connection's
 * active snapshot.
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
 * generated_hash semantics.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, lazy, useState } from 'react';
import {
  Banner,
  Button,
  EmptyState,
  Skeleton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToastStack,
  useToastQueue,
} from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { DesignMode } from './design/DesignMode.js';

/**
 * The diagram is LAZY, and that is load-bearing rather than tidy.
 *
 * `@xyflow/react` is ~59 KiB gz and does NOT tree-shake — 84 bytes between a
 * minimal and a full import. A static import here would put the whole library
 * in the synchronously-loaded set for every user on every route, which is the
 * exact failure `chunk-budget.json` records for `page-builder` and
 * `ImportWizardPage`. Nothing outside `./diagram/` imports it.
 */
const DiagramModeLazy = lazy(async () => {
  const mod = await import('./diagram/DiagramMode.js');
  return { default: mod.DiagramMode };
});
import { t } from '../../i18n/t.js';
import { capabilityNotes, modelCapabilitySource } from '../connect/capabilityNotes.js';
import { ColumnInspector } from './ColumnInspector.js';
import { DiffBar } from './DiffBar.js';
import { RelationsTab } from './RelationsTab.js';
import { SchemaTree } from './SchemaTree.js';
import { TableInspector } from './TableInspector.js';
import { putOverrides, regeneratePages, remapOverridesQuery,
  shapeRulesQuery, remapSchemaQuery } from './api.js';
import { enumValuesFor, tableById, type RemapSelection } from './model.js';
import { overrideKey, type RemapOverride } from './overrides.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
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
  // The rules an add-on's shape set: labelled, and asked about before one goes.
  const shapeRules = useQuery(shapeRulesQuery(connectionId));
  const buffer = useRemapBuffer(overridesQuery.data?.overrides);
  const toasts = useToastQueue();

  /**
   * Which half of the page is showing: the remap editor that changes what
   * Adminium DISPLAYS, or the designer that changes the customer's
   * DATABASE. One page, one navigation tree, two verbs — and deliberately
   * two buffers, so a single Save can never mix a label change with a
   * dropped column (trap 1).
   */
  const [mode, setMode] = useState<'remap' | 'design' | 'diagram'>('remap');

  /**
   * The honest absence, client half.
   *
   * The tab is REMOVED, not disabled. A disabled control still says "this is
   * something Adminium does, and you may not do it"; for a schema-file source
   * there is no database to change and for a read-only role there never will
   * be, so the truthful shape of the page is one without the surface — plus a
   * sentence saying why, which a disabled button does not carry either.
   *
   * The server refuses these four cases regardless (`unauthorableReason`).
   * This is the same fact rendered, never the enforcement.
   */
  const authoring = schemaQuery.data?.schemaAuthoring;
  const canDesign = authoring === undefined || authoring.authorable;
  const notAuthorableBecause: string | null =
    authoring === undefined || authoring.authorable
      ? null
      : authoring.reason === 'NO_LIVE_DATABASE'
        ? t(
            'studio:remap.noDesign.schemaFile',
            'This connection was created from a schema file, so there is no database to change. Labels and relations still work.',
          )
        : authoring.reason === 'READ_ONLY_ROLE'
          ? t(
              'studio:remap.noDesign.readOnlyRole',
              'This connection signs in with a read-only role, so Adminium cannot change its schema.',
            )
          : authoring.reason === 'NO_DDL_PRIVILEGE'
            ? t(
                'studio:remap.noDesign.noPrivilege',
                "This connection's role cannot create or alter tables. Grant it schema privileges, or connect a role that has them.",
              )
            : t(
                'studio:remap.noDesign.readOnlyIntent',
                'This connection was set up for read-only analytics. Change its intent in Settings to edit its schema.',
              );
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
        // A rule changed here is the operator's now, and loses its label.
        queryClient.invalidateQueries({ queryKey: shapeRulesQuery(connectionId).queryKey }),
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

  // Per-engine capability notes: what this source could not express,
  // so remapping expectations stay honest (e.g. SQLite has no comments to
  // import — labels set here are the labeling path).
  const sourceNotes = model === undefined ? [] : capabilityNotes(modelCapabilitySource(model));

  return (
    <PageSurface fill className="gap-3">
      {/* Heading and count line live in the TOPBAR, not this header: the shell
          renders an h1 for every route regardless, and this screen used to
          leave it on the path-derived fallback — so the chrome said "Home"
          while the body said "Schema", and so did the browser tab. What stays
          here is the mode tablist, which is a control, not a title. */}
      <PageActions
        title={t('studio:remap.title', 'Schema')}
        {...(schemaQuery.data === undefined
          ? {}
          : {
              subtitle: t(
                'studio:remap.subtitle',
                '{tables} tables · {applied} overrides applied',
                {
                  tables: String(schemaQuery.data.model.tables.length),
                  applied: String(schemaQuery.data.appliedOverrides),
                },
              ),
            })}
      />
      {/* No <header> wrapper any more: with the heading and count line hoisted
          to the topbar this is a row of controls, not a page header. */}
      <div role="tablist" aria-label={t('studio:remap.modeLabel', 'Editor mode')} className="flex flex-wrap gap-1">
        <Button
          role="tab"
          aria-selected={mode === 'remap'}
          variant={mode === 'remap' ? 'secondary' : 'ghost'}
          onClick={() => setMode('remap')}
        >
          {t('studio:remap.mode.remap', 'Labels & relations')}
        </Button>
        {canDesign ? (
          <Button
            role="tab"
            aria-selected={mode === 'design'}
            variant={mode === 'design' ? 'secondary' : 'ghost'}
            onClick={() => setMode('design')}
          >
            {t('studio:remap.mode.design', 'Design')}
          </Button>
        ) : null}
        <Button
          role="tab"
          aria-selected={mode === 'diagram'}
          variant={mode === 'diagram' ? 'secondary' : 'ghost'}
          onClick={() => setMode('diagram')}
        >
          {t('studio:remap.mode.diagram', 'Diagram')}
        </Button>
      </div>

      {notAuthorableBecause !== null ? (
        <Banner tone="info">{notAuthorableBecause}</Banner>
      ) : null}

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

      {model !== undefined && mode === 'design' && canDesign ? (
        <DesignMode
          connectionId={connectionId}
          snapshotId={schemaQuery.data?.snapshotId ?? ''}
          dialect={model.dialect}
          tables={model.tables as never}
          relations={model.relations as never}
          /*
           * B7. Without these, opening ANY table with an enum column staged
           * `enumValues: {}` — and a column typed `enum` with no values is
           * refused by the gate (`ENUM_ON_NON_ENUM_COLUMN`), so a table that
           * had one could be loaded, edited and never applied. The values live
           * in `model.enums`, keyed by the column's `enumRef`.
           */
          enumValuesByTable={Object.fromEntries(
            model.tables.map((table) => [
              table.id,
              Object.fromEntries(
                table.columns
                  .map((column) => [column.name, enumValuesFor(model, column)] as const)
                  .filter(([, values]) => values.length > 0),
              ),
            ]),
          )}
          nativeEnumsByTable={Object.fromEntries(
            model.tables.map((table) => [
              table.id,
              table.columns
                .filter(
                  (column) =>
                    column.enumRef !== null &&
                    model.enums.find((def) => def.id === column.enumRef)?.source === 'native',
                )
                .map((column) => column.name),
            ]),
          )}
          onApplied={() => {
            void queryClient.invalidateQueries({
              queryKey: remapSchemaQuery(connectionId).queryKey,
            });
          }}
        />
      ) : null}

      {model !== undefined && mode === 'diagram' ? (
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center p-10">
              <Spinner size="md" />
            </div>
          }
        >
          <DiagramModeLazy
            connectionId={connectionId}
            model={model}
            savedPositions={{}}
            canSaveLayout
            onOpenTable={() => setMode('design')}
          />
        </Suspense>
      ) : null}

      {model !== undefined && mode === 'remap' ? (
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
                shapeRules={shapeRules.data ?? []}
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

      {mode === 'remap' ? (
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
      ) : null}

      <ToastStack
        {...toasts.stackProps}
        dismissLabel={t('common.dismiss', 'Dismiss')}
        label={t('common.notifications', 'Notifications')}
      />
    </PageSurface>
  );
}
