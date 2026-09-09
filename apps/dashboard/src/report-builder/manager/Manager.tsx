// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The report manager (43-report-builder.md Appendix A M1–M17): the topbar's
 * title, subtitle and ONE primary *New {template|report}*; the toolbar; the
 * gallery or list of cards; the four empty states; and the card actions.
 *
 * TWO KINDS, ONE SCREEN. The Templates/Reports tray filters `kind`; the
 * counts come with every list reply, unfiltered, so the badges never lag the
 * rows and never respond to the search box (comp 580). Search is client-side
 * over the loaded list (comp 548) — a workspace has tens of documents, not
 * thousands, and a keystroke must not be a round trip.
 *
 * WHAT THE COMP DOES NOT DRAW IS NOT HERE: no group segment, no actions menu,
 * no archive, no import, no export (43 §5). Delete is a hard delete behind the
 * comp's own confirm. Duplicate lands the copy after its source and stays on
 * the manager (comp 555); the success toast with Undo is the house pattern
 * (34 DEP-20), added on top of the comp.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { tagForLocale, type LocaleId } from '@adminium/i18n';
import { Alert, Button, EmptyState, Spinner, Tabs, TabsContent } from '@adminium/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { formatSince } from '../../team/teamApi.js';
import { reportBuilderApi, type ReportDetail, type ReportDocumentKind, type ReportSummary } from '../api.js';
import { reportIcon } from '../icons.js';
import { invalidateReportDocuments, reportDocumentsQuery } from '../queries.js';
import { DeleteModal } from './DeleteModal.js';
import { GalleryCard, type DocumentActions, type RenameState } from './GalleryCard.js';
import { ListRow, ListTable } from './ListRow.js';
import { NewDocumentModal } from './NewDocumentModal.js';
import { Toolbar } from './Toolbar.js';
import { matchesSearch } from './model.js';
import { useManagerPrefs } from './useManagerPrefs.js';

export interface ReportManagerProps {
  initialTab?: ReportDocumentKind | undefined;
}

/** The comp's four empty-state copies (600). */
function emptyCopy(tab: ReportDocumentKind, searching: boolean): { title: string; body: string } {
  if (searching) {
    return {
      title:
        tab === 'template'
          ? t('reportBuilder:empty.noMatch.templates', 'No templates match')
          : t('reportBuilder:empty.noMatch.reports', 'No reports match'),
      body: t('reportBuilder:empty.noMatch.body', 'Try a different search term.'),
    };
  }
  return tab === 'template'
    ? {
        title: t('reportBuilder:empty.templates.title', 'No templates yet'),
        body: t('reportBuilder:empty.templates.body', 'Create a reusable report layout your team can build from.'),
      }
    : {
        title: t('reportBuilder:empty.reports.title', 'No reports yet'),
        body: t('reportBuilder:empty.reports.body', 'Build your first report from a template or a blank canvas.'),
      };
}

/** `New {template|report}` (comp 146; `tabSingular` 601). */
export function newLabel(tab: ReportDocumentKind): string {
  return tab === 'template' ? t('reportBuilder:new.template', 'New template') : t('reportBuilder:new.report', 'New report');
}

export function ReportManager({ initialTab = 'template' }: ReportManagerProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const localeTag = tagForLocale((bootstrap?.prefs.locale ?? 'en_US') as LocaleId);

  const [tab, setTabState] = useState<ReportDocumentKind>(initialTab);
  const [search, setSearch] = useState('');
  const [prefs, updatePrefs] = useManagerPrefs();
  const [rename, setRenameState] = useState<{ id: string; value: string; original: string } | null>(null);
  const [confirm, setConfirm] = useState<ReportSummary | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const list = useQuery(reportDocumentsQuery({ kind: tab }));
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const counts = list.data?.counts ?? { template: 0, report: 0 };
  const now = useMemo(() => Date.now(), [list.dataUpdatedAt]);

  const visible = useMemo(() => items.filter((doc) => matchesSearch(doc, search)), [items, search]);

  // The comp resets an open rename when the tab changes (580).
  const setTab = (next: ReportDocumentKind) => {
    setTabState(next);
    setRenameState(null);
  };

  const invalidate = useCallback(() => invalidateReportDocuments(queryClient), [queryClient]);
  const failToast = useCallback(
    (title: string, error: unknown) => {
      toasts.push({ variant: 'error', title, description: error instanceof Error ? error.message : undefined });
    },
    [toasts],
  );

  const patch = useMutation({
    mutationFn: (input: { id: string; name: string }) => reportBuilderApi.patch(input.id, { name: input.name }),
    onSuccess: () => void invalidate(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => reportBuilderApi.remove(id),
    onSuccess: () => void invalidate(),
  });
  const duplicate = useMutation({
    mutationFn: (doc: ReportSummary) => reportBuilderApi.duplicate(doc.id),
    onSuccess: (copy: ReportDetail, doc) => {
      void invalidate();
      toasts.push({
        variant: 'success',
        title: t('reportBuilder:toast.duplicated', 'Duplicated {name}', { name: doc.name }),
        action: {
          label: t('reportBuilder:toast.undo', 'Undo'),
          onAction: () => {
            remove.mutate(copy.id, {
              onError: (error) => failToast(t('undo.failed', 'Could not undo this change'), error),
            });
          },
        },
      });
    },
    onError: (error) => failToast(t('reportBuilder:toast.duplicateFailed', 'Couldn’t duplicate it'), error),
  });

  const deleteDoc = (doc: ReportSummary) => {
    remove.mutate(doc.id, {
      onSuccess: () => setConfirm(null),
      onError: (error) => {
        setConfirm(null);
        failToast(t('reportBuilder:toast.deleteFailed', 'Couldn’t delete it'), error);
      },
    });
  };

  // The comp's `commitRename` (562): trimmed, and an empty name becomes "Untitled".
  const commitRename = () => {
    if (rename === null) return;
    const trimmed = rename.value.trim();
    const value = trimmed === '' ? t('reportBuilder:manager.untitled', 'Untitled') : trimmed;
    const { id, original } = rename;
    setRenameState(null);
    if (value === original) return;
    patch.mutate({ id, name: value }, { onError: (error) => failToast(t('reportBuilder:toast.renameFailed', 'Couldn’t rename it'), error) });
  };
  const renameState: RenameState | null =
    rename === null
      ? null
      : {
          id: rename.id,
          value: rename.value,
          onChange: (value) => setRenameState((current) => (current === null ? null : { ...current, value })),
          onCommit: commitRename,
          onCancel: () => setRenameState(null),
        };

  const openEditor = (id: string) => {
    void navigate({ to: '/report-builder/$id', params: { id } });
  };
  const actions: DocumentActions = {
    onOpen: (doc) => openEditor(doc.id),
    onDuplicate: (doc) => duplicate.mutate(doc),
    onRename: (doc) => setRenameState({ id: doc.id, value: doc.name, original: doc.name }),
    onDelete: (doc) => setConfirm(doc),
  };

  const primary = newLabel(tab);
  const empty = emptyCopy(tab, search.trim() !== '');
  const tabLabel = tab === 'template' ? t('reportBuilder:manager.tabs.templates', 'Templates') : t('reportBuilder:manager.tabs.reports', 'Reports');
  const EmptyGlyph = reportIcon(tab === 'template' ? 'layout-template' : 'files');
  const PlusGlyph = reportIcon('plus');

  return (
    <>
      <PageActions
        title={t('reportBuilder:manager.title', 'Reports')}
        subtitle={t('reportBuilder:manager.subtitle', 'Reusable report layouts & the reports you build from them.')}
      >
        <Button size="topbar" iconLeft={<PlusGlyph />} onClick={() => setNewOpen(true)} data-testid="report-new">
          {primary}
        </Button>
      </PageActions>

      <PageSurface width="full" testId="report-manager">
        <Tabs variant="pill" value={tab} onValueChange={(value) => setTab(value === 'report' ? 'report' : 'template')} className="mx-auto max-w-wide">
          <Toolbar
            tab={tab}
            counts={counts}
            search={search}
            onSearchChange={setSearch}
            layout={prefs.layout}
            onLayoutChange={(layout) => updatePrefs({ layout })}
          />

          <TabsContent value={tab}>
            {list.isPending ? (
              <div className="flex justify-center py-20">
                <Spinner label={t('common.loading', 'Loading')} />
              </div>
            ) : list.isError ? (
              <Alert
                role="alert"
                tone="danger"
                title={t('reportBuilder:manager.loadFailed', 'Couldn’t load reports')}
                body={list.error instanceof Error ? list.error.message : undefined}
                action={
                  <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
                    {t('common.retry', 'Retry')}
                  </Button>
                }
              />
            ) : visible.length === 0 ? (
              <EmptyState
                data-testid="report-empty"
                icon={<EmptyGlyph />}
                tone="accent"
                title={empty.title}
                body={empty.body}
                actions={
                  <Button iconLeft={<PlusGlyph />} onClick={() => setNewOpen(true)}>
                    {primary}
                  </Button>
                }
                className="rounded-[18px] border-[1.5px] border-dashed border-border-strong bg-surface py-[70px]"
              />
            ) : prefs.layout === 'gallery' ? (
              <div data-testid="report-gallery" className="grid grid-cols-[repeat(auto-fill,minmax(258px,1fr))] gap-4">
                {visible.map((doc) => (
                  <GalleryCard key={doc.id} doc={doc} tab={tab} actions={actions} rename={renameState} />
                ))}
              </div>
            ) : (
              <ListTable label={tabLabel}>
                {visible.map((doc) => (
                  <ListRow key={doc.id} doc={doc} tab={tab} actions={actions} rename={renameState} updated={formatSince(doc.updatedAt, localeTag, now)} />
                ))}
              </ListTable>
            )}
          </TabsContent>
        </Tabs>
      </PageSurface>

      {confirm === null ? null : (
        <DeleteModal kind={confirm.kind} name={confirm.name} busy={remove.isPending} onCancel={() => setConfirm(null)} onConfirm={() => deleteDoc(confirm)} />
      )}
      {newOpen ? (
        <NewDocumentModal
          kind={tab}
          onClose={() => setNewOpen(false)}
          onCreated={(detail) => {
            setNewOpen(false);
            void invalidate();
            openEditor(detail.id);
          }}
        />
      ) : null}
    </>
  );
}
