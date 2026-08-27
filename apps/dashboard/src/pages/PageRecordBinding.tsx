// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-record` binding (30-record-pages.md WS-C): mounts the record detail
 * page for `/p/$slug/r/$recordId` — the envelope's `config.detail.template`
 * resolved by TemplateMount (30 D1).
 *
 * What the binding wires that the widget cannot know:
 *
 * - the typed body (`columns`, `keyField`, `readOnly`, `detail` — 30-T01);
 * - the related-tab adapter (30 D5): per-tab lists through a CrudApi bound to
 *   the REFERENCING table, column specs + default sort from that table's own
 *   page envelope when one exists (the runtime table→slug map from
 *   bootstrap), honest linklessness otherwise;
 * - the per-record activity feed (30 D6) over the audit entity filter
 *   (WS-A), gated by the same role check the audit page uses — absent, not
 *   disabled, for a viewer (the server enforces regardless);
 * - the per-caller `canUpdate`/`canDelete` capabilities the page reply
 *   resolved from the caller's table grants (30 D4) — a read-only grantee's
 *   record page has no Edit/Delete to 403 on;
 * - breadcrumb/back + document title, delete → back to the list with the
 *   undo toast at app level, and the deleted-record 404 state in-outlet.
 */
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseCrudDetailConfig } from '@adminium/engine/config';
import {
  PageRecord,
  type CrudListParams,
  type PageRecordRelated,
  type PageRecordRelatedResolution,
  type RecordActivityFeed,
} from '@adminium/widgets';

import { api } from '../app/api.js';
import { bootstrapQuery, findPageBySlug, flattenNav, slugForTable } from '../app/bootstrap.js';
import { hrefForPage } from '../app/links.js';
import { createCrudApi } from '../api/crud.js';
import { pageQuery } from '../api/pages.js';
import { diffRows, type AuditListReply } from '../audit/auditApi.js';
import { t } from '../i18n/t.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { hasStudioAccess } from '../studio/StudioGuard.js';
import { StatePage } from '../states/StatePage.js';
import { aggParamsOf, parseColumns, parseDefaultSort, withFkDisplay, withLookups } from './columnSpecs.js';
import type { PageTemplateProps } from './template-types.js';

export function PageRecordBinding({ page, adapters, recordId, canUpdate, canDelete, canUnmask }: PageTemplateProps) {
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
    () => (crud === null ? null : withLookups(crud, lookups, aggParamsOf(columns))),
    [crud, columns, lookups],
  );
  const detail = useMemo(() => parseCrudDetailConfig(page.config), [page.config]);
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
  useEffect(() => {
    if (hero === null) return;
    const previous = document.title;
    document.title = `${hero} · ${pageTitle}`;
    return () => {
      document.title = previous;
    };
  }, [hero, pageTitle]);

  /** The related-tab host adapter (30 D5) — resolution is per activation. */
  const related = useMemo<PageRecordRelated>(() => {
    const listApiFor = (table: string) =>
      connectionId === null ? null : createCrudApi(connectionId, table);
    // Lookup params per resolved table, captured by resolve() below: a tab
    // whose lending page carries lookup columns lists with them, so those
    // cells render values instead of dashes. Unresolved tables list bare.
    const tabLookups = new Map<string, string[]>();
    return {
      list: (table: string, params: CrudListParams) => {
        const bound = listApiFor(table);
        if (bound === null) return Promise.resolve({ data: [] });
        const lookups = tabLookups.get(table) ?? [];
        return bound.list(lookups.length === 0 ? params : { ...params, lookup: lookups });
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
          // rows still render (09 §3.1 never-crash).
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
   * and related records (30 D6: absent, not disabled).
   */
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
            // images themselves in v1 (30 D6). `diffRows` returns the UNION of
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
        {...(hero === null ? {} : { title: hero })}
        subtitle={pageTitle}
        backTo={listHref}
      />
      <PageRecord
        api={boundCrud ?? crud}
        columns={columns}
        source={{ connectionId, table: sourceTable ?? crud.table }}
        recordId={recordId}
        keyField={keyField}
        readOnly={readOnly}
        // Grants-driven affordances (30 D4): the envelope's `readOnly` blanks
        // everything structurally; these blank per-action on the caller's
        // table grants. Undefined keeps the widget's permissive default.
        canUpdate={canUpdate}
        canDelete={canDelete}
        // PII fields reveal only for callers the server sent clear values to.
        canUnmask={canUnmask}
        tabs={detail?.tabs ?? []}
        related={related}
        activity={activity}
        onEvent={adapters.onEvent}
        onDeleted={handleDeleted}
        onMissing={() => setMissing(true)}
        onLoaded={({ hero: value }) => setHero(value)}
      />
    </>
  );
}
