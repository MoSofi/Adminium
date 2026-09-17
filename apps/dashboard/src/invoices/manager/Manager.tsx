// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The invoice manager: the topbar's title, subtitle and ONE primary
 * *New {template|invoice}*; the toolbar; the gallery or list of cards in
 * optional groups; the empty states; and the card actions.
 *
 * TWO KINDS, ONE SCREEN. The Templates/Invoices tray filters `kind`; the
 * counts come with every list reply, unfiltered, so the badges never lag the
 * rows and never respond to the search box (comp 1423). Search is
 * client-side over the loaded list (comp 1369) — a workspace has tens of
 * documents, not thousands, and a keystroke must not be a round trip.
 *
 * WHAT THE COMP DOES NOT DRAW IS NOT HERE: no actions menu, no
 * archive, no import, no export. Delete is a hard delete behind the comp's
 * own confirm. Duplicate lands the copy after its source and stays on the
 * manager (comp 1384); the success toast with Undo is the house pattern,
 * added on top of the comp.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Files, LayoutTemplate, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { tagForLocale, type LocaleId } from '@adminium/i18n';
import { Alert, Button, EmptyState, Spinner, Tabs, TabsContent } from '@adminium/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { formatSince } from '../../team/teamApi.js';
import { invoicesApi, type InvoiceDetail, type InvoiceDocumentKind, type InvoiceSummary } from '../api.js';
import { invalidateInvoices, invoicesQuery } from '../queries.js';
import { DeleteModal } from './DeleteModal.js';
import { GalleryCard, type DocumentActions, type RenameState } from './GalleryCard.js';
import { GroupHeader, ListGroupRow } from './GroupHeader.js';
import { ListRow, ListTable } from './ListRow.js';
import { NewDocumentModal } from './NewDocumentModal.js';
import { Toolbar } from './Toolbar.js';
import { groupDocuments, matchesSearch } from './model.js';
import { useManagerPrefs } from './useManagerPrefs.js';

export interface InvoiceManagerProps {
  initialTab?: InvoiceDocumentKind | undefined;
}

/** The comp's four empty-state copies (1461-1463). */
function emptyCopy(tab: InvoiceDocumentKind, searching: boolean): { title: string; body: string } {
  if (searching) {
    return {
      title: tab === 'template' ? t('invoices:empty.noMatch.templates', 'No templates match') : t('invoices:empty.noMatch.invoices', 'No invoices match'),
      body: t('invoices:empty.noMatch.body', 'Try a different search term.'),
    };
  }
  return tab === 'template'
    ? {
        title: t('invoices:empty.templates.title', 'No templates yet'),
        body: t('invoices:empty.templates.body', 'Create a reusable invoice template your team can build from.'),
      }
    : {
        title: t('invoices:empty.invoices.title', 'No invoices yet'),
        body: t('invoices:empty.invoices.body', 'Build your first invoice from a template or a blank canvas.'),
      };
}

/** `New {template|invoice}` (comp 188, 224; `tabSingular` 1466). */
export function newLabel(tab: InvoiceDocumentKind): string {
  return tab === 'template' ? t('invoices:new.template', 'New template') : t('invoices:new.invoice', 'New invoice');
}

export function InvoiceManager({ initialTab = 'template' }: InvoiceManagerProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const localeTag = tagForLocale((bootstrap?.prefs.locale ?? 'en_US') as LocaleId);

  const [tab, setTabState] = useState<InvoiceDocumentKind>(initialTab);
  const [search, setSearch] = useState('');
  const [prefs, updatePrefs] = useManagerPrefs();
  const [rename, setRenameState] = useState<{ id: string; value: string; original: string } | null>(null);
  const [confirm, setConfirm] = useState<InvoiceSummary | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const list = useQuery(invoicesQuery({ kind: tab }));
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const counts = list.data?.counts ?? { template: 0, invoice: 0 };
  const now = useMemo(() => Date.now(), [list.dataUpdatedAt]);

  const visible = useMemo(() => items.filter((doc) => matchesSearch(doc, search)), [items, search]);
  const groups = useMemo(() => groupDocuments(visible, prefs.groupBy), [visible, prefs.groupBy]);

  // The comp resets an open rename when the tab changes (1424-1425).
  const setTab = (next: InvoiceDocumentKind) => {
    setTabState(next);
    setRenameState(null);
  };

  const invalidate = useCallback(() => invalidateInvoices(queryClient), [queryClient]);
  const failToast = useCallback(
    (title: string, error: unknown) => {
      toasts.push({ variant: 'error', title, description: error instanceof Error ? error.message : undefined });
    },
    [toasts],
  );

  const patch = useMutation({
    mutationFn: (input: { id: string; name: string }) => invoicesApi.patch(input.id, { name: input.name }),
    onSuccess: () => void invalidate(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => invoicesApi.remove(id),
    onSuccess: () => void invalidate(),
  });
  const duplicate = useMutation({
    mutationFn: (doc: InvoiceSummary) => invoicesApi.duplicate(doc.id),
    onSuccess: (copy: InvoiceDetail, doc) => {
      void invalidate();
      toasts.push({
        variant: 'success',
        title: doc.kind === 'template' ? t('invoices:toast.duplicated.template', 'Template duplicated') : t('invoices:toast.duplicated.invoice', 'Invoice duplicated'),
        action: {
          label: t('common.undo', 'Undo'),
          onAction: () => {
            remove.mutate(copy.id, {
              onError: (error) => failToast(t('undo.failed', 'Could not undo this change'), error),
            });
          },
        },
      });
    },
    onError: (error) => failToast(t('invoices:toast.duplicateFailed', 'Could not duplicate it'), error),
  });

  const deleteDoc = (doc: InvoiceSummary) => {
    remove.mutate(doc.id, {
      onSuccess: () => setConfirm(null),
      onError: (error) => {
        setConfirm(null);
        failToast(t('invoices:toast.deleteFailed', 'Could not delete it'), error);
      },
    });
  };

  // The comp's `commitRename` (1391): trimmed, and an empty name becomes "Untitled".
  const commitRename = () => {
    if (rename === null) return;
    const trimmed = rename.value.trim();
    const value = trimmed === '' ? t('invoices:manager.untitled', 'Untitled') : trimmed;
    const { id, original } = rename;
    setRenameState(null);
    if (value === original) return;
    patch.mutate({ id, name: value }, { onError: (error) => failToast(t('invoices:toast.renameFailed', 'Could not rename it'), error) });
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
    void navigate({ to: '/invoices/$id', params: { id } });
  };
  const actions: DocumentActions = {
    onOpen: (doc) => openEditor(doc.id),
    onDuplicate: (doc) => duplicate.mutate(doc),
    onRename: (doc) => setRenameState({ id: doc.id, value: doc.name, original: doc.name }),
    onDelete: (doc) => setConfirm(doc),
  };

  const primary = newLabel(tab);
  const empty = emptyCopy(tab, search.trim() !== '');
  const tabLabel = tab === 'template' ? t('invoices:manager.tabs.templates', 'Templates') : t('invoices:manager.tabs.invoices', 'Invoices');

  return (
    <>
      <PageActions title={t('invoices:manager.title', 'Invoices')} subtitle={t('invoices:manager.subtitle', 'Reusable templates & the invoices you build from them.')}>
        <Button size="topbar" iconLeft={<Plus />} onClick={() => setNewOpen(true)} data-testid="invoices-new">
          {primary}
        </Button>
      </PageActions>

      <PageSurface width="full" testId="invoices-manager">
        <Tabs variant="pill" value={tab} onValueChange={(value) => setTab(value === 'invoice' ? 'invoice' : 'template')} className="mx-auto max-w-wide">
          <Toolbar
            tab={tab}
            counts={counts}
            groupBy={prefs.groupBy}
            onGroupByChange={(groupBy) => updatePrefs({ groupBy })}
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
                title={t('invoices:manager.loadFailed', 'Couldn’t load invoices')}
                body={list.error instanceof Error ? list.error.message : undefined}
                action={
                  <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
                    {t('common.retry', 'Retry')}
                  </Button>
                }
              />
            ) : visible.length === 0 ? (
              <EmptyState
                data-testid="invoices-empty"
                icon={tab === 'template' ? <LayoutTemplate /> : <Files />}
                tone="accent"
                title={empty.title}
                body={empty.body}
                actions={
                  <Button iconLeft={<Plus />} onClick={() => setNewOpen(true)}>
                    {primary}
                  </Button>
                }
                className="rounded-[18px] border-[1.5px] border-dashed border-border-strong bg-surface py-[70px]"
              />
            ) : prefs.layout === 'gallery' ? (
              <div data-testid="invoices-gallery" className="flex flex-col gap-7">
                {groups.map((group) => (
                  <section key={group.key} data-testid="invoices-group" aria-label={group.header?.label}>
                    {group.header === null ? null : <GroupHeader glyph={group.header.glyph} label={group.header.label} sub={group.header.sub} />}
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-4">
                      {group.items.map((doc) => (
                        <GalleryCard key={doc.id} doc={doc} actions={actions} rename={renameState} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <ListTable label={tabLabel}>
                {groups.map((group) => (
                  <div key={group.key} role="rowgroup" data-testid="invoices-group" aria-label={group.header?.label}>
                    {group.header === null ? null : <ListGroupRow glyph={group.header.glyph} label={group.header.label} sub={group.header.sub} />}
                    {group.items.map((doc) => (
                      <ListRow key={doc.id} doc={doc} actions={actions} rename={renameState} updated={formatSince(doc.updatedAt, localeTag, now)} />
                    ))}
                  </div>
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
