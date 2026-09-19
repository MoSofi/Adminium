// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email manager: the topbar's title, actions menu and *New
 * {kind}*; the toolbar; the gallery or list of cards in optional groups; the
 * empty states; and the card actions with their toasts.
 *
 * TWO KINDS, ONE SCREEN. The Templates/Campaigns tray filters `kind`; the
 * counts come with every list reply so the badges never lag the rows.
 * Search is client-side over the loaded list (the comp's rule, 1049) — a
 * workspace has tens of documents, not thousands, and a keystroke must not
 * be a round trip.
 *
 * ARCHIVED MODE (D4) is the same screen over `archived=true` rows with a
 * leading chip to leave: cards do not open, the Edit slot restores, Delete
 * becomes *Delete for good* (or *Reset to built-in* on a shipped key).
 *
 * EVERY DESTRUCTIVE TOAST HAS UNDO: delete is an archive the toast
 * reverses with `PATCH archived:false`; duplicate's Undo deletes the copy —
 * a copy is never a built-in, so `DELETE` removes it rather than resetting.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Archive, AtSign, Download, Ellipsis, LayoutTemplate, Plus, Send, Settings, Upload } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { tagForLocale, type LocaleId } from '@adminium/i18n';
import {
  Alert,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Spinner,
  Tabs,
  TabsContent,
} from '@adminium/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { AskAssistant } from '../../assistant/AskAssistant.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { formatSince } from '../../team/teamApi.js';
import { emailApi, emailExportUrl, type EmailDocumentDetail, type EmailDocumentKind, type EmailDocumentSummary, type EmailImportReply } from '../api.js';
import { useEmailManagerAssistant } from '../assistant.js';
import { emailDocumentsQuery, invalidateEmailDocuments } from '../queries.js';
import { DeleteModal, type DeleteModalMode } from './DeleteModal.js';
import { GalleryCard, type DocumentActions, type RenameState } from './GalleryCard.js';
import { GroupHeader } from './GroupHeader.js';
import { ImportModal } from './ImportModal.js';
import { ListRow, ListTable } from './ListRow.js';
import { NewDocumentModal } from './NewDocumentModal.js';
import { Toolbar } from './Toolbar.js';
import { groupDocuments, localeFacts, matchesSearch, type LocaleFacts } from './model.js';
import { useManagerPrefs } from './useManagerPrefs.js';

export interface EmailManagerProps {
  initialTab?: EmailDocumentKind | undefined;
  initialArchived?: boolean | undefined;
}

/** The comp's four empty-state copies (1392), plus archived mode's two. */
function emptyCopy(tab: EmailDocumentKind, searching: boolean, archived: boolean): { title: string; body: string } {
  if (archived) {
    return {
      title:
        tab === 'template'
          ? t('email:empty.archived.templates', 'No archived templates')
          : t('email:empty.archived.campaigns', 'No archived campaigns'),
      body: t('email:empty.archived.body', 'Anything you delete lands here and can be restored.'),
    };
  }
  if (searching) {
    return {
      title:
        tab === 'template'
          ? t('email:empty.noMatch.templates', 'No templates match')
          : t('email:empty.noMatch.campaigns', 'No campaigns match'),
      body: t('email:empty.noMatch.body', 'Try a different search term.'),
    };
  }
  return tab === 'template'
    ? {
        title: t('email:empty.templates.title', 'No templates yet'),
        body: t('email:empty.templates.body', 'Design a reusable email your team can send from.'),
      }
    : {
        title: t('email:empty.campaigns.title', 'No campaigns yet'),
        body: t('email:empty.campaigns.body', 'Create a campaign from a template or a blank canvas.'),
      };
}

/** *Export all* is a same-origin download (D14): an anchor click, so the session cookie rides along. */
export function startDownload(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '';
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

type Confirm = { mode: DeleteModalMode; doc: EmailDocumentSummary };

export function EmailManager({ initialTab = 'template', initialArchived = false }: EmailManagerProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const localeTag = tagForLocale((bootstrap?.prefs.locale ?? 'en_US') as LocaleId);

  const [tab, setTabState] = useState<EmailDocumentKind>(initialTab);
  // What the assistant is told this page is showing. The tab travels: a
  // question asked on the campaigns tab is a question about campaigns.
  const assistantHost = useEmailManagerAssistant(tab);
  const [archived, setArchivedState] = useState(initialArchived);
  const [search, setSearch] = useState('');
  const [prefs, updatePrefs] = useManagerPrefs();
  const [rename, setRenameState] = useState<{ id: string; value: string; original: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const list = useQuery(emailDocumentsQuery({ kind: tab, archived }));
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const counts = list.data?.counts ?? { template: 0, campaign: 0, archived: 0 };
  const now = useMemo(() => Date.now(), [list.dataUpdatedAt]);

  const siblings = useMemo(() => [...new Set(items.map((doc) => doc.locale))], [items]);
  const factsOf = useMemo(() => {
    const cache = new Map<string, LocaleFacts>();
    return (locale: string): LocaleFacts => {
      let facts = cache.get(locale);
      if (facts === undefined) {
        facts = localeFacts(locale, siblings);
        cache.set(locale, facts);
      }
      return facts;
    };
  }, [siblings]);
  const visible = useMemo(() => items.filter((doc) => matchesSearch(doc, factsOf(doc.locale), search)), [items, factsOf, search]);
  const groups = useMemo(() => groupDocuments(visible, prefs.groupBy, factsOf), [visible, prefs.groupBy, factsOf]);

  const setTab = (next: EmailDocumentKind) => {
    setTabState(next);
    setRenameState(null);
  };
  const setArchived = (next: boolean) => {
    setArchivedState(next);
    setRenameState(null);
    setSearch('');
  };

  const invalidate = useCallback(() => invalidateEmailDocuments(queryClient), [queryClient]);
  const failToast = useCallback(
    (title: string, error: unknown) => {
      toasts.push({ variant: 'error', title, description: error instanceof Error ? error.message : undefined });
    },
    [toasts],
  );
  const kindOf = (doc: Pick<EmailDocumentSummary, 'kind'>): EmailDocumentKind => doc.kind;

  const patch = useMutation({
    mutationFn: (input: { id: string; body: Parameters<typeof emailApi.patch>[1] }) => emailApi.patch(input.id, input.body),
    onSuccess: () => void invalidate(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => emailApi.remove(id),
    onSuccess: () => void invalidate(),
  });
  const duplicate = useMutation({
    mutationFn: (doc: EmailDocumentSummary) => emailApi.duplicate(doc.id),
    onSuccess: (copy: EmailDocumentDetail, doc) => {
      void invalidate();
      toasts.push({
        variant: 'success',
        title:
          kindOf(doc) === 'template'
            ? t('email:toast.duplicated.template', 'Template duplicated')
            : t('email:toast.duplicated.campaign', 'Campaign duplicated'),
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
    onError: (error) => failToast(t('email:toast.duplicateFailed', 'Could not duplicate it'), error),
  });

  const archiveDoc = (doc: EmailDocumentSummary) => {
    patch.mutate(
      { id: doc.id, body: { archived: true } },
      {
        onSuccess: () => {
          toasts.push({
            variant: 'success',
            title:
              kindOf(doc) === 'template'
                ? t('email:toast.deleted.template', 'Template deleted')
                : t('email:toast.deleted.campaign', 'Campaign deleted'),
            action: {
              label: t('common.undo', 'Undo'),
              onAction: () => {
                patch.mutate(
                  { id: doc.id, body: { archived: false } },
                  { onError: (error) => failToast(t('undo.failed', 'Could not undo this change'), error) },
                );
              },
            },
          });
        },
        onError: (error) => failToast(t('email:toast.deleteFailed', 'Could not delete it'), error),
      },
    );
  };

  const restoreDoc = (doc: EmailDocumentSummary) => {
    patch.mutate(
      { id: doc.id, body: { archived: false } },
      {
        onSuccess: () => {
          toasts.push({
            variant: 'success',
            title:
              kindOf(doc) === 'template'
                ? t('email:toast.restored.template', 'Template restored')
                : t('email:toast.restored.campaign', 'Campaign restored'),
          });
        },
        onError: (error) => failToast(t('email:toast.restoreFailed', 'Could not restore it'), error),
      },
    );
  };

  const removeForGood = (doc: EmailDocumentSummary, mode: DeleteModalMode) => {
    remove.mutate(doc.id, {
      onSuccess: () => {
        setConfirm(null);
        toasts.push({
          variant: 'success',
          title:
            mode === 'reset'
              ? t('email:toast.reset', 'Reset to the built-in copy')
              : kindOf(doc) === 'template'
                ? t('email:toast.deletedForGood.template', 'Template deleted for good')
                : t('email:toast.deletedForGood.campaign', 'Campaign deleted for good'),
        });
      },
      onError: (error) => {
        setConfirm(null);
        failToast(t('email:toast.deleteFailed', 'Could not delete it'), error);
      },
    });
  };

  const commitRename = () => {
    if (rename === null) return;
    const value = rename.value.trim();
    const { id, original } = rename;
    setRenameState(null);
    if (value === '' || value === original) return;
    patch.mutate(
      { id, body: { name: value } },
      { onError: (error) => failToast(t('email:toast.renameFailed', 'Could not rename it'), error) },
    );
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
    void navigate({ to: '/email-templates/$id', params: { id } });
  };
  const actions: DocumentActions = {
    onOpen: (doc) => openEditor(doc.id),
    onDuplicate: (doc) => duplicate.mutate(doc),
    onRename: (doc) => setRenameState({ id: doc.id, value: doc.name, original: doc.name }),
    onDelete: (doc) => setConfirm({ mode: 'archive', doc }),
    onRestore: restoreDoc,
    onDeleteForGood: (doc) => setConfirm({ mode: doc.isBuiltin ? 'reset' : 'forGood', doc }),
  };

  const onImported = (reply: EmailImportReply) => {
    setImportOpen(false);
    void invalidate();
    toasts.push({
      variant: reply.errors.length === 0 ? 'success' : 'warning',
      title: t('email:import.done', '{created} imported · {replaced} replaced · {skipped} skipped', {
        created: reply.created,
        replaced: reply.replaced,
        skipped: reply.skipped,
      }),
      description:
        reply.errors.length === 0
          ? undefined
          : t('email:import.errors', '{count, plural, one {# document} other {# documents}} could not be imported', {
              count: reply.errors.length,
            }),
    });
  };

  const newLabel = tab === 'template' ? t('email:new.template', 'New template') : t('email:new.campaign', 'New campaign');
  const goToEmailSettings = () => {
    void navigate({ to: '/studio/settings', hash: 'email' });
  };
  const empty = emptyCopy(tab, search.trim() !== '', archived);

  return (
    <>
      <PageActions
        title={t('email:title', 'Email templates')}
        subtitle={t('email:subtitle', 'Design reusable emails & the campaigns you send from them.')}
      >
        <AskAssistant host={assistantHost} slot="manager" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton variant="bordered" size="lg" label={t('email:actions.menu', 'More actions')} data-testid="email-actions-menu">
              <Ellipsis className="size-[18px]" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-[14px] p-[7px]">
            <DropdownMenuLabel>{t('email:actions.eyebrow', 'Actions')}</DropdownMenuLabel>
            <DropdownMenuItem icon={<Upload />} onSelect={() => setImportOpen(true)}>
              {t('email:actions.import', 'Import template')}
            </DropdownMenuItem>
            <DropdownMenuItem icon={<AtSign />} onSelect={goToEmailSettings}>
              {t('email:actions.senders', 'Manage senders')}
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Download />} onSelect={() => startDownload(emailExportUrl({ kind: tab }))}>
              {t('email:actions.exportAll', 'Export all')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Settings />} onSelect={goToEmailSettings}>
              {t('email:actions.settings', 'Email settings')}
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Archive />} onSelect={() => setArchived(true)}>
              {t('email:actions.archived', 'Archived')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="topbar" iconLeft={<Plus />} onClick={() => setNewOpen(true)} data-testid="email-new">
          {newLabel}
        </Button>
      </PageActions>

      <PageSurface width="full" testId="email-manager">
        <Tabs
          variant="pill"
          value={tab}
          onValueChange={(value) => setTab(value === 'campaign' ? 'campaign' : 'template')}
          className="mx-auto max-w-wide"
        >
          <Toolbar
            tab={tab}
            counts={counts}
            groupBy={prefs.groupBy}
            onGroupByChange={(groupBy) => updatePrefs({ groupBy })}
            search={search}
            onSearchChange={setSearch}
            layout={prefs.layout}
            onLayoutChange={(layout) => updatePrefs({ layout })}
            archived={archived}
            onLeaveArchived={() => setArchived(false)}
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
              title={t('email:loadFailed', 'Couldn’t load email templates')}
              body={list.error instanceof Error ? list.error.message : undefined}
              action={
                <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
                  {t('common.retry', 'Retry')}
                </Button>
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState
              data-testid="email-empty"
              icon={tab === 'template' ? <LayoutTemplate /> : <Send />}
              tone="accent"
              title={empty.title}
              body={empty.body}
              actions={
                archived ? undefined : (
                  <Button iconLeft={<Plus />} onClick={() => setNewOpen(true)}>
                    {newLabel}
                  </Button>
                )
              }
              className="rounded-[18px] border-[1.5px] border-dashed border-border-strong bg-surface"
            />
          ) : prefs.layout === 'gallery' ? (
            <div data-testid="email-gallery" className="flex flex-col gap-[26px]">
              {groups.map((group) => (
                <section key={group.key} data-testid="email-group" aria-label={group.header?.label}>
                  {group.header === null ? null : <GroupHeader icon={group.header.icon} label={group.header.label} sub={group.header.sub} />}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(252px,1fr))] gap-4">
                    {group.items.map((doc) => (
                      <GalleryCard key={doc.id} doc={doc} facts={factsOf(doc.locale)} archived={archived} actions={actions} rename={renameState} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div data-testid="email-list" className="flex flex-col gap-[22px]">
              {groups.map((group) => (
                <section key={group.key} data-testid="email-group" aria-label={group.header?.label}>
                  {group.header === null ? null : <GroupHeader dense icon={group.header.icon} label={group.header.label} sub={group.header.sub} />}
                  <ListTable label={group.header?.label ?? (tab === 'template' ? t('email:tabs.templates', 'Templates') : t('email:tabs.campaigns', 'Campaigns'))}>
                    {group.items.map((doc) => (
                      <ListRow
                        key={doc.id}
                        doc={doc}
                        facts={factsOf(doc.locale)}
                        archived={archived}
                        actions={actions}
                        rename={renameState}
                        updated={formatSince(doc.updatedAt, localeTag, now)}
                      />
                    ))}
                  </ListTable>
                </section>
              ))}
            </div>
          )}
          </TabsContent>
        </Tabs>
      </PageSurface>

      {confirm === null ? null : (
        <DeleteModal
          mode={confirm.mode}
          kind={confirm.doc.kind}
          name={confirm.doc.name}
          busy={patch.isPending || remove.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm.mode === 'archive') {
              const { doc } = confirm;
              setConfirm(null);
              archiveDoc(doc);
            } else {
              removeForGood(confirm.doc, confirm.mode);
            }
          }}
        />
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
      {importOpen ? <ImportModal onClose={() => setImportOpen(false)} onImported={onImported} /> : null}
    </>
  );
}
