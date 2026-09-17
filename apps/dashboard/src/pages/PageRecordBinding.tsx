// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-record` binding (WS-C): mounts the record detail page for
 * `/p/$slug/r/$recordId` — the envelope's `config.detail.template` resolved
 * by TemplateMount.
 *
 * What the binding wires that the widget cannot know:
 *
 * - the typed body (`columns`, `keyField`, `readOnly`, `detail`);
 * - the related-tab adapter: per-tab lists through a CrudApi bound to the
 * REFERENCING table, column specs + default sort from that table's own page
 * envelope when one exists (the runtime table→slug map from bootstrap),
 * honest linklessness otherwise;
 * - the per-record activity feed over the audit entity filter (WS-A),
 * gated by the same role check the audit page uses — absent, not disabled,
 * for a viewer (the server enforces regardless);
 * - the sidecar attachments adapter and its realtime refresh (D27): the
 * table's widget-data channel re-creates the adapter, so a file attached in
 * another tab appears in an open panel without a remount;
 * - the per-caller `canUpdate`/`canDelete` capabilities the page reply
 * resolved from the caller's table grants — a read-only grantee's record
 *   page has no Edit/Delete to 403 on;
 * - breadcrumb/back + document title, delete → back to the list with the
 *   undo toast at app level, and the deleted-record 404 state in-outlet.
 */
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseCrudAttachmentsConfig, parseCrudDetailConfig } from '@adminium/engine/config';
// The DEEP path, not `@adminium/engine/config`: that barrel is entry-resident
// (its blocks are read on first paint) and a re-export through it would pull
// this module into every cold boot for one lazy binding's sake.
import { formatRefList, parseRefList } from '@adminium/widgets/page-config';
import {
  PageRecord,
  type CrudApi,
  type CrudListParams,
  type PageRecordAttachments,
  type PageRecordRelated,
  type RecordAttachment,
  type PageRecordRelatedResolution,
  type RecordActivityFeed,
} from '@adminium/widgets';
import { streamChannel } from '@adminium/widgets/binding';

import { api } from '../app/api.js';
import { bootstrapQuery, findPageBySlug, flattenNav, slugForTable } from '../app/bootstrap.js';
import { hrefForPage } from '../app/links.js';
import { createCrudApi } from '../api/crud.js';
import { pageQuery } from '../api/pages.js';
import { diffRows, type AuditListReply } from '../audit/auditApi.js';
import {
  deleteFile,
  listRecordFiles,
  resolveFiles,
  restoreFile,
  uploadFile,
  type FileDto,
} from '../files/api.js';
import { t } from '../i18n/t.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { hasStudioAccess } from '../studio/StudioGuard.js';
import {
  DocumentsPanel,
  MakeDocumentButton,
  useDocumentProviders,
  useProfilesForTable,
} from '../documents/DocumentsPanel.js';
import { entityKey } from '../documents/documentsApi.js';
import { StatePage } from '../states/StatePage.js';
import { appStreamTransport } from './lmc/stream.js';
import { ProjectActionButtons, useProjectActions } from './projectActions.js';
import {
  parseColumns,
  parseDefaultSort,
  projectionParamsOf,
  withFkDisplay,
  withLookups,
} from './columnSpecs.js';
import type { PageTemplateProps } from './template-types.js';

export function PageRecordBinding({
  page,
  adapters,
  recordId,
  canUpdate,
  canAttach,
  canDelete,
  canUnmask,
  currency,
}: PageTemplateProps) {
  const crud = adapters.crud;
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const queryClient = useQueryClient();
  const router = useRouter();

  const { columns, lookups } = useMemo(
    () => withFkDisplay(parseColumns(page.config, page.id)),
    [page.config, page.id],
  );
  // The record fetch carries the page's lookup + aggregate params — explicit
  // AND the derived FK-display ones — so lookup, reverse-link and FK-chip
  // columns render on the record page exactly as in the list.
  const boundCrud = useMemo(
    () => {
      if (crud === null) return null;
      const { agg, compute } = projectionParamsOf(columns, page.config);
      return withLookups(crud, lookups, agg, compute);
    },
    [crud, columns, lookups, page.config],
  );
  const detail = useMemo(() => parseCrudDetailConfig(page.config), [page.config]);
  const attachmentsConfig = useMemo(() => parseCrudAttachmentsConfig(page.config), [page.config]);
  const keyField = typeof page.config['keyField'] === 'string' ? page.config['keyField'] : null;
  const readOnly = page.config['readOnly'] === true;
  const connectionId = page.source.connectionId;
  const sourceTable = page.source.table;

  // The list URL this record page is a child of — derived from bootstrap by
  // pageId (PageTemplateProps carries no slug). Hidden pages included: a
  // cascade-owned child's record page still breadcrumbs back to its (hidden,
  // but routable) list.
  const navItem = useMemo(
    () =>
      [...flattenNav(bootstrap.nav), ...(bootstrap.hiddenPages ?? [])].find(
        (item) => item.pageId === page.id,
      ) ?? null,
    [bootstrap, page.id],
  );
  const listSlug = navItem?.slug ?? null;
  const listHref = listSlug === null ? '/' : hrefForPage(listSlug);
  const pageTitle = navItem?.fallback ?? page.title.fallback;

  // A deleted/unknown record renders the in-outlet 404 (criterion 7); reset
  // when the route moves to another record of the same page.
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setMissing(false);
  }, [recordId]);

  // Key-field value, reported by the widget once the record loads — feeds the
  // breadcrumb title and the document title.
  const [hero, setHero] = useState<string | null>(null);
  useEffect(() => {
    setHero(null);
  }, [recordId]);

  /** The related-tab host adapter — resolution is per activation. */
  const related = useMemo<PageRecordRelated>(() => {
    const listApiFor = (table: string) =>
      connectionId === null ? null : createCrudApi(connectionId, table);
    // Projection params per resolved table, captured by resolve() below: a tab
    // whose lending page carries lookup, reverse-link or DERIVED columns lists
    // with them, so those cells render values instead of dashes. Unresolved
    // tables list bare.
    //
    // `agg` and `compute` were the defect this closes: the tab forwarded
    // `lookup` and nothing else, so a related tab showed an em-dash where the
    // lending page showed a count — and would have shown one where it shows a
    // total.
    const tabLookups = new Map<string, string[]>();
    const tabProjections = new Map<string, { agg: string[]; compute: string | undefined }>();
    return {
      list: (table: string, params: CrudListParams) => {
        const bound = listApiFor(table);
        if (bound === null) return Promise.resolve({ data: [] });
        const lookups = tabLookups.get(table) ?? [];
        const projections = tabProjections.get(table);
        return bound.list({
          ...params,
          ...(lookups.length === 0 ? {} : { lookup: lookups }),
          ...(projections === undefined || projections.agg.length === 0
            ? {}
            : { agg: projections.agg }),
          ...(projections?.compute === undefined ? {} : { compute: projections.compute }),
        });
      },
      resolve: async (table: string): Promise<PageRecordRelatedResolution | null> => {
        // Hidden pages resolve too (30 follow-up): a cascade-owned child's
        // page keeps lending its column specs to this tab even though the
        // sidebar no longer lists it.
        const slug = slugForTable(bootstrap, connectionId, table);
        if (slug === null) return null;
        const item = findPageBySlug(bootstrap, slug);
        if (item === null) return null;
        try {
          const result = await queryClient.ensureQueryData(pageQuery(item.pageId));
          if (result.status !== 'ok') return null;
          // The lending page's plan, FK-display lookups included — tab rows
          // show FK chips too, and they deserve names the same way.
          const plan = withFkDisplay(parseColumns(result.page.config, item.pageId));
          tabLookups.set(table, plan.lookups);
          tabProjections.set(table, projectionParamsOf(plan.columns, result.page.config));
          return {
            columns: plan.columns,
            defaultSort: parseDefaultSort(result.page.config),
            // The in-tab "New row" gate: the TARGET page's per-caller create
            // capability AND its own readOnly — the same pair that governs the
            // button on that page itself, so the tab can never offer a write
            // the child page would refuse.
            canCreate:
              result.canCreate !== false &&
              (result.page.config as { readOnly?: unknown }).readOnly !== true,
          };
        } catch {
          // A page we cannot read degrades the tab to derived columns — the
          // rows still render (never-crash).
          return null;
        }
      },
      linkable: (table: string) => slugForTable(bootstrap, connectionId, table) !== null,
      // The write half of the same seam `list` reads through — the in-tab
      // create posts to the child table with the caller's session.
      api: (table: string) => listApiFor(table),
    };
  }, [bootstrap, connectionId, queryClient]);

  /**
   * Per-record activity over the WS-A entity filter. Same UX gate as the
   * audit page (role ≥ Admin — StudioGuard's rule); the server independently
   * enforces `system:audit:read`. A viewer's record page simply has fields
   * and related records (absent, not disabled).
   */
  /**
   * The entity's table, as both the attachments adapter and the subscription
   * below name it: the envelope's own source first, because that is the value
   * the server denormalizes onto `adminium_files` and publishes the channel
   * for.
   */
  const entityTable = sourceTable ?? crud?.table ?? '';

  /**
   * A file attached or replaced in another tab — or by another user — has to
   * reach an open panel. Without this the list changes only for the session
   * that did the upload, and everyone else sees yesterday's files until they
   * remount the page.
   *
   * A NONCE, not a query invalidation, because the panel is not a react-query
   * consumer: `AttachmentsPanel` owns its list state and reloads when the
   * `attachments` adapter's identity changes (`useEffect(reload, [reload])`
   * over a `reload` keyed on the adapter — packages/widgets page-record). So
   * re-creating the adapter is, for this widget, the same act
   * `invalidateQueries(['data', …])` performs for a query: the server said
   * this changed, go read it again.
   *
   * The channel is the table's widget-data channel — the one the server
   * publishes the event on, and the only channel over this table a client may
   * subscribe to (`table:*` is publish-only, see routes/data/index.ts). The
   * shared transport reference-counts it, so a record page adds a channel and
   * never a second socket.
   *
   * It reloads on ANY attachments event for the table rather than matching the
   * record: the publisher masks the pk it carries, so a PII natural key would
   * never compare equal to the id in this URL. The cost of being imprecise is
   * one small GET, and only when somebody actually attaches a file.
   */
  const [attachmentsVersion, setAttachmentsVersion] = useState(0);
  useEffect(() => {
    if (attachmentsConfig?.enabled !== true) return;
    if (connectionId === null || entityTable === '') return;
    return appStreamTransport().subscribe(streamChannel(connectionId, entityTable), (event) => {
      if (event.type === 'record.attachments') setAttachmentsVersion((current) => current + 1);
    });
  }, [attachmentsConfig, connectionId, entityTable]);

  /**
   * The record's attachments — in whichever of the two modes this page
   * uses.
   *
   * `config.attachments.column` names a column on the customer's own table
   * (38's default) and the list lives in that column's value; without it the
   * files are linked on Adminium's side (37's sidecar, now the fallback for a
   * source whose schema Adminium cannot author). Built only when the block
   * says so — a page without one gets `null` and the panel does not render.
   */
  const attachments = useMemo<PageRecordAttachments | null>(() => {
    // A dependency, not a value: a bump re-creates this adapter, which is what
    // makes the panel reload (see the subscription above).
    void attachmentsVersion;
    if (attachmentsConfig?.enabled !== true) return null;
    if (attachmentsConfig.column !== undefined) {
      return columnAttachments({
        column: attachmentsConfig.column,
        crud: boundCrud,
        connectionId,
        table: entityTable,
        recordId: recordId ?? '',
        ...(attachmentsConfig.destinationId === undefined
          ? {}
          : { destinationId: attachmentsConfig.destinationId }),
      });
    }
    if (connectionId === null || recordId === undefined) return null;
    const table = entityTable;
    const toAttachment = (file: FileDto): RecordAttachment => ({
      id: file.id,
      filename: file.filename,
      mime: file.mime,
      sizeBytes: file.sizeBytes,
      createdAt: file.createdAt,
      contentPath: file.contentPath,
    });
    return {
      list: async () => (await listRecordFiles({ connectionId, table, recordId })).map(toAttachment),
      upload: async ({ file, signal, onProgress }) =>
        toAttachment(
          (
            await uploadFile({
              file,
              connectionId,
              table,
              // Attached on upload: the record already exists on this page, so
              // there is no unattached window to sweep up.
              recordId,
              ...(attachmentsConfig.destinationId === undefined
                ? {}
                : { destinationId: attachmentsConfig.destinationId }),
              signal,
              onProgress,
            })
          ).data,
        ),
      remove: async (fileId) => {
        await deleteFile(fileId);
      },
      restore: async (fileId) => {
        await restoreFile(fileId);
      },
    };
  }, [attachmentsConfig, connectionId, recordId, entityTable, attachmentsVersion]);

  const activity = useMemo<RecordActivityFeed | null>(() => {
    if (!hasStudioAccess(bootstrap.roles)) return null;
    if (connectionId === null || recordId === undefined) return null;
    return {
      list: async ({ cursor }) => {
        const params = new URLSearchParams({
          connectionId,
          entityTable: sourceTable ?? '',
          entityId: recordId,
        });
        if (cursor !== undefined && cursor !== '') params.set('cursor', cursor);
        const reply = await api.get<AuditListReply>(`/api/v1/audit?${params.toString()}`);
        return {
          entries: reply.entries.map((entry) => ({
            id: entry.id,
            actorLabel: entry.actorLabel,
            action: entry.action,
            at: entry.createdAt,
            // Changed-column count from the before/after images — never the
            // images themselves in v1. `diffRows` returns the UNION of
            // both images' fields with a `changed` flag; only the flagged rows
            // are the count (the union is every column of the row).
            changedFields:
              entry.action === 'record.update'
                ? diffRows(entry.changes).filter((row) => row.changed).length
                : undefined,
          })),
          nextCursor: reply.nextCursor,
        };
      },
    };
  }, [bootstrap.roles, connectionId, sourceTable, recordId]);

  const invalidateList = useCallback(() => {
    if (crud !== null) {
      void queryClient.invalidateQueries({ queryKey: ['data', crud.connectionId, crud.table] });
    }
  }, [queryClient, crud]);

  /** Delete lands back on the list with the row gone + the undo toast (D4). */
  const handleDeleted = useCallback(
    (undoToken: string | null) => {
      invalidateList();
      adapters.notifyUndoable({
        title: t('mutation.deleted', 'Record deleted'),
        undoToken,
        onUndone: invalidateList,
      });
      router.history.push(listHref);
    },
    [adapters, invalidateList, router, listHref],
  );

  /*
   * DOCUMENTS.
   *
   * Two questions, in this order, and both are queries rather than build
   * flags: is a `document-render` provider installed at all, and does any
   * MAPPING cover this table. The first says a document can be drawn
   * somewhere; only the second says it can be drawn from here.
   *
   * The hooks run unconditionally — a conditional hook is a different
   * component on the next render — and answer `enabled: false` until they have
   * something to ask about.
   */
  const providers = useDocumentProviders();
  const profiles = useProfilesForTable(connectionId, sourceTable ?? crud?.table ?? '');
  const hasProvider = providers.data?.installed === true;

  const documentPanels = useMemo(() => {
    if (!hasProvider || recordId === undefined || crud === null) return [];
    return [
      {
        id: 'documents',
        title: t('ui:documents.panel.title', 'Documents'),
        content: (
          <DocumentsPanel
            entityTable={sourceTable ?? crud.table}
            /*
             * The REGISTER's key for this row, not the row's id. The register
             * stores `id=7`, built from the source table's whole primary key,
             * and a panel asking for `7` matched nothing — which looked
             * exactly like "this record has no documents". The panel's own
             * test had the encoded form hard-coded in its fixture, so it went
             * on passing.
             */
            entityId={entityKey({ id: recordId })}
          />
        ),
      },
    ];
  }, [hasProvider, recordId, crud, sourceTable, t]);

  const documentActions = useMemo(() => {
    const usable = profiles.data ?? [];
    if (!hasProvider || usable.length === 0 || recordId === undefined) return [];
    return [
      {
        id: 'make-document',
        label: t('ui:documents.make.label', 'Make a document'),
        content: (
          <MakeDocumentButton
            profiles={usable}
            // The record's own primary key, as the page addresses it. The
            // server re-reads the row from this, with the caller's grants.
            pk={{ id: recordId }}
          />
        ),
      },
    ];
  }, [hasProvider, profiles.data, recordId, t]);

  /*
   * PROJECT ACTIONS — buttons the project's own code defines for this table.
   * After one runs, the record is read again: a new `api` object is what
   * makes PageRecord fetch, and a derived object keeps every method the
   * bound adapter has.
   */
  const [actionRuns, setActionRuns] = useState(0);
  const projectActions = useProjectActions(
    connectionId,
    sourceTable ?? crud?.table,
    useCallback(() => setActionRuns((n) => n + 1), []),
  );
  const recordApi = useMemo(() => {
    const base = boundCrud ?? crud;
    return actionRuns === 0 || base === null ? base : (Object.create(base) as typeof base);
  }, [boundCrud, crud, actionRuns]);
  const recordActions = useMemo(() => {
    if (recordId === undefined || projectActions.record.length === 0) return documentActions;
    return [
      ...documentActions,
      {
        id: 'project-actions',
        label: t('projectAction.menu', 'Actions'),
        content: <ProjectActionButtons actions={projectActions} id={recordId} />,
      },
    ];
  }, [documentActions, projectActions, recordId, t]);

  if (crud === null) {
    // Bad generation output (record page without a source) — caught by the
    // PageRenderer error boundary and rendered as the page error card.
    throw new Error(`page-record document ${page.id} has no source table`);
  }
  if (recordId === undefined) {
    // Envelope-level `template: 'page-record'` visited at `/p/$slug` — a
    // hand-authored shell with no record to show. Degrade honestly.
    return (
      <StatePage stateId="not-found" fullPage={false} />
    );
  }
  if (missing) {
    return <StatePage stateId="not-found" fullPage={false} />;
  }

  return (
    <>
      {/* Breadcrumb: page title → key-field value. The topbar back control
          returns to the list; the h1 carries the record's key field once
          loaded (the shell's nav label names the list, not the record). */}
      <PageActions
        {...(hero === null
          ? {}
          : // The tab carries BOTH halves of the breadcrumb, because the h1
            // alone is the record — "Northwind" in a tab strip does not say
            // which page you are on, and two records of two pages would be two
            // unrelated names. Until the key field loads there is nothing
            // honest to say, so the tab keeps the shell's name for the list.
            { title: hero, documentTitle: `${hero} · ${pageTitle}` })}
        subtitle={pageTitle}
        backTo={listHref}
      />
      <PageRecord
        api={recordApi ?? crud}
        columns={columns}
        source={{ connectionId, table: sourceTable ?? crud.table }}
        recordId={recordId}
        keyField={keyField}
        readOnly={readOnly}
        // Grants-driven affordances: the envelope's `readOnly` blanks
        // everything structurally; these blank per-action on the caller's
        // table grants. Undefined keeps the widget's permissive default.
        canUpdate={canUpdate}
        canDelete={canDelete}
        // PII fields reveal only for callers the server sent clear values to.
        canUnmask={canUnmask}
        // The connection's own currency for money cells.
        {...(currency === undefined ? {} : { currency })}
        tabs={detail?.tabs ?? []}
        related={related}
        activity={activity}
        // Sidecar attachments. Absent ⇒ no panel, the same rule
        // `related` and `activity` follow — a page whose `config.attachments`
        // is off renders exactly as it did before the feature existed.
        attachments={attachments}
        // Not the same as `canUpdate`: an attach is authorised by `update` on
        // the entity's table but it is stated separately so the panel
        // never offers a dropzone the server would refuse. On a READ-ONLY
        // source the record cannot be edited and a sidecar file still can be —
        // that asymmetry is the whole point of the sidecar mode.
        canAttach={canAttach}
        {...(attachmentsConfig?.maxBytes === undefined ? {} : { maxFileBytes: attachmentsConfig.maxBytes })}
        /*
         * Documents. Both the panel and the Make button are ABSENT until a
         * `document-render` provider is installed AND a mapping covers this
         * table — an affordance that cannot do anything is worse than no
         * affordance, because it invites a click and then explains itself.
         */
        {...(documentPanels.length === 0 ? {} : { panels: documentPanels })}
        {...(recordActions.length === 0 ? {} : { actions: recordActions })}
        onEvent={adapters.onEvent}
        onDeleted={handleDeleted}
        onMissing={() => setMissing(true)}
        onLoaded={({ hero: value }) => setHero(value)}
      />
      {projectActions.dialog}
    </>
  );
}

/**
 * The COLUMN-mode attachments adapter.
 *
 * The files this record owns are the value of one column on the customer's own
 * table, so every operation here goes through the CRUD route rather than
 * through `/files`:
 *
 *   list    read the record, split the column value, resolve the references
 *   upload  POST /files (naming the column, so the server mints the configured
 *           reference shape), then PATCH the record with it appended
 *   remove  PATCH with the reference gone — the server's reconcile hook is
 *           what trashes the file, exactly as it does for a form edit
 *   restore un-trash the file, then PATCH it back into the list
 *
 * WHY REMOVE DOES NOT CALL `DELETE /files/:id`. The column is the truth. A
 * delete that left the reference in place would produce a record pointing at a
 * trashed file — the panel would show it gone and the grid would still show
 * the chip. Writing the column and letting the hook follow keeps one authority
 * for what this record owns, and gives Undo something coherent to restore.
 *
 * RE-READ BEFORE EVERY WRITE, rather than trusting a list this adapter cached:
 * the record may have been edited in another tab or by the form on this page,
 * and a PATCH built from a stale list would silently drop whatever it missed.
 */
function columnAttachments(input: {
  column: string;
  crud: CrudApi | null;
  connectionId: string | null;
  table: string;
  recordId: string;
  destinationId?: string | undefined;
}): PageRecordAttachments | null {
  const { column, connectionId, table, recordId } = input;
  const crud = input.crud;
  if (crud === null || connectionId === null || table === '' || recordId === '') return null;

  const toAttachment = (file: FileDto): RecordAttachment => ({
    id: file.id,
    filename: file.filename,
    mime: file.mime,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
    contentPath: file.contentPath,
  });

  // `const` arrows rather than hoisted declarations: a function declaration can
  // in principle be reached before the null guard above, so TypeScript will not
  // carry the narrowing of `crud` into one.
  /** The references this record's column names right now, straight from the row. */
  const currentRefs = async (): Promise<string[]> => {
    const { data } = await crud.get(recordId);
    return parseRefList(data[column]);
  };

  const writeRefs = async (refs: readonly string[]): Promise<void> => {
    await crud.update(recordId, { [column]: formatRefList(refs) });
  };

  return {
    async list() {
      const refs = await currentRefs();
      if (refs.length === 0) return [];
      const resolved = await resolveFiles(refs);
      // Order follows the COLUMN, not the resolve reply: the list is the
      // customer's data and its order is theirs. An entry that resolves to
      // nothing — a foreign link, or a file this reader may not see — is
      // dropped here, because the panel has no way to render one.
      return refs
        .map((ref) => resolved.get(ref) ?? null)
        .filter((file): file is FileDto => file !== null)
        .map(toAttachment);
    },

    async upload({ file, signal, onProgress }) {
      const result = await uploadFile({
        file,
        connectionId,
        table,
        // The COLUMN, not the record: the server mints the reference in this
        // column's configured shape, and the PATCH below is what attaches it.
        column,
        ...(input.destinationId === undefined ? {} : { destinationId: input.destinationId }),
        signal,
        onProgress,
      });
      const ref = result.ref ?? result.data.id;
      await writeRefs([...(await currentRefs()), ref]);
      return toAttachment(result.data);
    },

    async remove(fileId) {
      const refs = await currentRefs();
      const resolved = await resolveFiles(refs);
      // Matched by the FILE the reference resolves to, not by string equality:
      // the same file can be named by an id, a content URL or a destination
      // key, and the panel only ever knows the id.
      await writeRefs(refs.filter((ref) => resolved.get(ref)?.id !== fileId));
    },

    async restore(fileId) {
      // Bytes back first, then the reference: a column naming a trashed file
      // renders as unresolved, which is the state this is undoing.
      const file = await restoreFile(fileId);
      const refs = await currentRefs();
      await writeRefs([...refs, file.id]);
    },
  };
}
