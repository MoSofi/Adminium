// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email editor (`editor/`): the header, the
 * canvas and the inspector over ONE draft that only `save()` sends
 * (D1).
 *
 * THE GUARD (D1). A router blocker asks before any navigation away from a
 * dirty draft — the topbar's Back, the sidebar, a language switch, the
 * browser's own back — and `beforeunload` covers the tab. One navigation
 * bypasses it on purpose: the one that follows a delete (the row is
 * archived; an unsaved edit to an archived row has nowhere to go).
 *
 * STRUCTURE EDITS GO THROUGH `commitOp` (the comp's 1325): the op is applied
 * to this draft, and when live sibling variations exist the mirror modal
 * asks whether to queue the same op for them — it rides the next save.
 *
 * SELECTION drives the inspector: picking anything — a canvas section, a
 * pinned row, an outline row — opens the Design tab on it (the comp's
 * `selectBlock` / `pickPinned`). The last-focused field is where the
 * variable chips append (D18).
 *
 * `Ctrl/⌘+S` saves, inside the name field too (`mod+s` is on the shortcut
 * manager's typing allowlist).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { dirForLocale, isLocaleId, tagForLocale, type LocaleId } from '@adminium/i18n';

import { ApiError } from '../../app/api.js';
import { bootstrapQuery } from '../../app/bootstrap.js';
import { DEFAULT_BRANDING, brandingQuery } from '../../app/branding.js';
import { resolveFiles, type FileDto } from '../../files/api.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { useShortcut } from '../../shell/ShortcutsProvider.js';
import { emailSettingsQuery } from '../../studio/settings/workspaceApi.js';
import { emailApi, type EmailBlockRecord, type EmailDocument, type EmailDocumentDetail, type EmailMirrorOp, type EmailRunView, type EmailSavedBlock } from '../api.js';
import { api } from '../../app/api.js';
import type { UsersListReply } from '../../team/teamApi.js';
import { AskAssistant } from '../../assistant/AskAssistant.js';
import { useEmailEditorAssistant } from '../assistant.js';
import { DeleteModal } from '../manager/DeleteModal.js';
import { localeFacts, statusOf } from '../manager/model.js';
import { defaultBlockData, type EmailBlockKind } from '../model/blocks.js';
import { putBodyOf } from '../model/doc.js';
import { applyBlockOp, cloneBlock, newBlockId } from '../model/ops.js';
import { EMAIL_DOCUMENTS_KEY, emailSavedBlocksQuery, invalidateEmailDocuments } from '../queries.js';
import { useRunProgress } from '../useRunProgress.js';
import { blockHint, blockLabel } from './blockText.js';
import { blockDef } from './canvas/blocks/index.js';
import { EmailCanvas, type CanvasDevice, type CanvasSelection } from './canvas/EmailCanvas.js';
import { effectiveBrand } from './canvas/MailShell.js';
import { EditorHeader } from './EditorHeader.js';
import { Inspector, type DesignHeader, type InspectorTab } from './inspector/Inspector.js';
import { AttachmentsPanel } from './inspector/panels/AttachmentsPanel.js';
import { BlockPanel } from './inspector/panels/BlockPanel.js';
import { BrandingPanel } from './inspector/panels/BrandingPanel.js';
import { FooterPanel, SubjectPanel } from './inspector/panels/SubjectFooterPanels.js';
import { WorkspaceDocuments } from './inspector/panels/WorkspaceDocuments.js';
import { languageRows } from './LanguageMenu.js';
import { BlockPicker } from './overlays/BlockPicker.js';
import { DiscardChangesModal } from './overlays/DiscardChangesModal.js';
import { ImagePicker } from './overlays/ImagePicker.js';
import { MirrorModal } from './overlays/MirrorModal.js';
import { SendCampaignModal, type SendCampaignBody } from './overlays/SendCampaignModal.js';
import { TestSendModal, type Teammate } from './overlays/TestSendModal.js';
import { useDocumentEdits, type ActiveField } from './useDocumentEdits.js';
import { useEditorDraft } from './useEditorDraft.js';

export interface EditorProps {
  detail: EmailDocumentDetail;
}

export type { ActiveField } from './useDocumentEdits.js';

const EMPTY_FILES: ReadonlyMap<string, FileDto | null> = new Map();
const NO_SAVED: readonly EmailSavedBlock[] = [];

/**
 * The shell scrolls the page under a sticky topbar, so the editor's own
 * sticky header and its sticky inspector need the topbar's height (and the
 * header's) as custom properties. Measured, because the topbar wraps.
 */
function useStickyOffsets(header: React.RefObject<HTMLElement | null>): { topbar: string; header: string } {
  const [offsets, setOffsets] = useState({ topbar: 0, header: 0 });
  useLayoutEffect(() => {
    const topbar = document.querySelector<HTMLElement>('[data-part="topbar"]');
    const measure = () => {
      setOffsets({ topbar: topbar?.getBoundingClientRect().height ?? 0, header: header.current?.getBoundingClientRect().height ?? 0 });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    if (topbar !== null) observer.observe(topbar);
    if (header.current !== null) observer.observe(header.current);
    return () => observer.disconnect();
  }, [header]);
  return { topbar: `${String(Math.round(offsets.topbar))}px`, header: `${String(Math.round(offsets.header))}px` };
}

export function Editor({ detail }: EditorProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const [state, actions] = useEditorDraft(detail);
  const branding = useQuery(brandingQuery()).data ?? DEFAULT_BRANDING;
  const senders = useQuery({ ...emailSettingsQuery(), retry: false }).data?.senders ?? [];
  const savedBlocks = useQuery(emailSavedBlocksQuery()).data?.blocks ?? NO_SAVED;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingLocale, setAddingLocale] = useState<string | null>(null);
  const [selection, setSelection] = useState<CanvasSelection>({ kind: 'branding' });
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('sections');
  const [device, setDevice] = useState<CanvasDevice>('desktop');
  const [picker, setPicker] = useState<{ index: number } | null>(null);
  const [mirror, setMirror] = useState<{ op: EmailMirrorOp; label: string } | null>(null);
  const [activeField, setActiveField] = useState<ActiveField | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [imagePickFor, setImagePickFor] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const edits = useDocumentEdits(actions, activeField);
  const headerRef = useRef<HTMLElement | null>(null);
  const stickyOffsets = useStickyOffsets(headerRef);
  const dirtyRef = useRef(state.dirty);
  dirtyRef.current = state.dirty;
  const bypassGuard = useRef(false);

  const blocker = useBlocker({
    shouldBlockFn: () => dirtyRef.current && !bypassGuard.current,
    enableBeforeUnload: () => dirtyRef.current && !bypassGuard.current,
    withResolver: true,
  });

  const failToast = useCallback(
    (title: string, error: unknown) => {
      toasts.push({ variant: 'error', title, description: error instanceof Error ? error.message : undefined });
    },
    [toasts],
  );

  const save = useCallback(async () => {
    if (state.status === 'saving') return;
    try {
      await actions.save();
    } catch (error) {
      failToast(t('email:editor.saveFailed', 'Could not save'), error);
    }
  }, [actions, failToast, state.status]);

  useShortcut({
    id: 'email-save',
    group: 'Editing',
    label: t('email:editor.shortcutSave', 'Save the email'),
    keys: ['⌘', 'S'],
    handler: () => {
      void save();
    },
  });

  // --- the document's files (image blocks), resolved once per set of ids (D9) ---
  const draft = state.draft;
  const blocks = draft.document.blocks;
  const fileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const block of blocks) {
      if (block.block === 'email.image' && typeof block.data['fileId'] === 'string' && block.data['fileId'] !== '') ids.add(block.data['fileId']);
    }
    return [...ids].sort();
  }, [blocks]);
  const resolved = useQuery({
    queryKey: [...EMAIL_DOCUMENTS_KEY, 'files', fileIds] as const,
    queryFn: () => resolveFiles(fileIds),
    enabled: fileIds.length > 0,
    staleTime: 60_000,
  });
  const files = resolved.data ?? EMPTY_FILES;

  // --- selection ---------------------------------------------------------------
  const selectFor = useCallback((next: CanvasSelection) => {
    setSelection(next);
    setInspectorTab('design');
  }, []);
  const selectedBlock = selection.kind === 'block' ? (blocks.find((block) => block.id === selection.id) ?? null) : null;

  // --- the assistant -----------------------------------------------------------
  /**
   * A draft the assistant proposed, put on the screen. ONE `histMutate`, so
   * one undo takes the whole thing back — which is the right size of step for
   * something that happened to your draft while you watched. Nothing is
   * written: the save chip goes to *Unsaved changes* and `Ctrl/⌘+S` still
   * decides. The selection lands on the first block whose contents differ, so
   * the inspector opens on something that actually changed.
   */
  const applyDocument = useCallback(
    (next: EmailDocument) => {
      actions.histMutate((current) => ({ ...current, document: next }));
      const changed =
        next.blocks.find((block, index) => JSON.stringify(blocks[index] ?? null) !== JSON.stringify(block)) ?? next.blocks[0];
      selectFor(changed === undefined ? { kind: 'subject' } : { kind: 'block', id: changed.id });
    },
    [actions, blocks, selectFor],
  );
  const assistantHost = useEmailEditorAssistant({ documentId: detail.id, draft: draft.document, applyDocument });

  // --- structure ---------------------------------------------------------------
  const liveSiblings = detail.languages.filter((l) => !l.archived && l.id !== detail.id).length;
  const facts = localeFacts(detail.locale, [detail.locale]);

  const commitOp = useCallback(
    (op: EmailMirrorOp, label: string) => {
      actions.histMutate((current) => ({ ...current, document: { ...current.document, blocks: applyBlockOp(current.document.blocks, op) } }));
      if (liveSiblings > 0) setMirror({ op, label });
      else toasts.push({ variant: 'info', title: label });
    },
    [actions, liveSiblings, toasts],
  );

  const insertBlock = (block: EmailBlockRecord, index: number, label: string) => {
    setPicker(null);
    commitOp({ kind: 'insert', index, block: { ...block } }, t('email:canvas.blockAdded', '{label} added', { label }));
    selectFor({ kind: 'block', id: block.id });
  };
  const pickKind = (kind: EmailBlockKind) => {
    if (picker === null) return;
    insertBlock({ id: newBlockId(), block: kind, data: defaultBlockData(kind), style: {} }, picker.index, blockLabel(kind));
  };
  const savedToBlock = (saved: EmailSavedBlock): EmailBlockRecord => {
    const raw = saved.block as Partial<EmailBlockRecord>;
    return cloneBlock({
      id: '',
      block: typeof raw.block === 'string' ? raw.block : 'email.text',
      data: typeof raw.data === 'object' && raw.data !== null ? raw.data : {},
      style: typeof raw.style === 'object' && raw.style !== null ? raw.style : {},
    });
  };
  const pickSaved = (saved: EmailSavedBlock) => {
    if (picker === null) return;
    insertBlock(savedToBlock(saved), picker.index, saved.name);
  };
  const dupBlockAt = (id: string) => {
    const index = blocks.findIndex((block) => block.id === id);
    const source = blocks[index];
    if (source === undefined) return;
    const copy = cloneBlock(source);
    commitOp({ kind: 'insert', index: index + 1, block: { ...copy } }, t('email:inspector.sectionDuplicated', 'Section duplicated'));
    selectFor({ kind: 'block', id: copy.id });
  };
  const delBlockAt = (id: string) => {
    const index = blocks.findIndex((block) => block.id === id);
    if (index === -1) return;
    if (selection.kind === 'block' && selection.id === id) setSelection({ kind: 'branding' });
    commitOp({ kind: 'delete', index }, t('email:inspector.sectionRemoved', 'Section removed'));
  };
  const moveBlock = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return;
    commitOp({ kind: 'move', from, to }, t('email:inspector.sectionsReordered', 'Sections reordered'));
  };

  const saveBlock = useMutation({
    mutationFn: (input: { name: string; block: EmailBlockRecord }) => emailApi.saveBlock(input.name, { ...input.block }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...EMAIL_DOCUMENTS_KEY, 'blocks'] });
      toasts.push({ variant: 'success', title: t('email:inspector.savedToBlocks', 'Saved to your blocks') });
    },
    onError: (error) => failToast(t('email:inspector.saveBlockFailed', 'Could not save the block'), error),
  });

  // --- test send (D1: the on-screen document) ---------------------------------------
  const bootstrap = useQuery(bootstrapQuery()).data;
  const me = bootstrap?.user.id ?? null;
  const localeTag = tagForLocale((bootstrap?.prefs.locale ?? 'en_US') as LocaleId);
  const teammates: readonly Teammate[] =
    useQuery({
      queryKey: ['email-templates', 'teammates'] as const,
      queryFn: () => api.get<UsersListReply>('/api/v1/users?status=active'),
      retry: false,
      staleTime: 60_000,
      select: (reply) =>
        reply.users
          .filter((user) => user.id !== me && user.email.trim() !== '')
          .slice(0, 3)
          .map((user) => ({ name: user.name.trim() === '' ? user.email : user.name, email: user.email })),
    }).data ?? [];
  const sendTest = async (to: string[]) => {
    const { document } = putBodyOf(draft, []);
    const reply = await emailApi.testSend(detail.id, { to, document });
    toasts.push({
      variant: 'success',
      title: t('email:testSend.queued', 'Test email sent to {count, plural, one {# recipient} other {# recipients}}', { count: reply.queued }),
    });
  };

  // --- the header's actions ------------------------------------------------------
  // --- campaign runs (D11, D12): save first, then POST /send; the chip follows the latest run ---
  const activeRun = detail.run !== undefined && (detail.run.status === 'scheduled' || detail.run.status === 'running') ? detail.run : null;
  const progress = useRunProgress(detail.run);
  const sendCampaign = async (body: SendCampaignBody): Promise<EmailRunView> => {
    if (dirtyRef.current) await actions.save();
    const { run } = await emailApi.send(detail.id, body);
    await invalidateEmailDocuments(queryClient);
    return run;
  };
  const cancelRun = useMutation({
    mutationFn: (run: EmailRunView) => emailApi.cancelRun(run.id).then(() => run.status),
    onSuccess: (was) => {
      void invalidateEmailDocuments(queryClient);
      toasts.push({ variant: 'info', title: was === 'running' ? t('email:campaign.sendingCancelled', 'Sending cancelled') : t('email:campaign.cancelled', 'Schedule cancelled') });
    },
    onError: (error) => failToast(t('email:campaign.cancelFailed', 'Could not cancel'), error),
  });

  const kindNoun = detail.kind;
  const duplicate = useMutation({
    mutationFn: () => emailApi.duplicate(detail.id),
    onSuccess: (copy) => {
      void invalidateEmailDocuments(queryClient);
      toasts.push({
        variant: 'success',
        title: kindNoun === 'template' ? t('email:toast.duplicated.template', 'Template duplicated') : t('email:toast.duplicated.campaign', 'Campaign duplicated'),
        action: {
          label: t('common.undo', 'Undo'),
          onAction: () => {
            emailApi
              .remove(copy.id)
              .then(() => invalidateEmailDocuments(queryClient))
              .catch((error: unknown) => failToast(t('undo.failed', 'Could not undo this change'), error));
          },
        },
      });
    },
    onError: (error) => failToast(t('email:toast.duplicateFailed', 'Could not duplicate it'), error),
  });

  const archive = useMutation({
    mutationFn: () => emailApi.patch(detail.id, { archived: true }),
    onSuccess: () => {
      setConfirmDelete(false);
      void invalidateEmailDocuments(queryClient);
      toasts.push({
        variant: 'success',
        title: kindNoun === 'template' ? t('email:toast.deleted.template', 'Template deleted') : t('email:toast.deleted.campaign', 'Campaign deleted'),
        action: {
          label: t('common.undo', 'Undo'),
          onAction: () => {
            emailApi
              .patch(detail.id, { archived: false })
              .then(() => invalidateEmailDocuments(queryClient))
              .catch((error: unknown) => failToast(t('undo.failed', 'Could not undo this change'), error));
          },
        },
      });
      bypassGuard.current = true;
      void navigate({ to: '/email-templates', search: kindNoun === 'campaign' ? { kind: 'campaign' } : {} });
    },
    onError: (error) => {
      setConfirmDelete(false);
      failToast(t('email:toast.deleteFailed', 'Could not delete it'), error);
    },
  });

  const openDocument = (id: string) => {
    void navigate({ to: '/email-templates/$id', params: { id } });
  };

  const addLanguage = async (locale: string) => {
    setAddingLocale(locale);
    try {
      const created = await emailApi.addLanguage(detail.id, locale);
      void invalidateEmailDocuments(queryClient);
      const target = localeFacts(locale, [locale]);
      toasts.push({
        variant: 'success',
        title: created.needsTranslation
          ? t('email:editor.languages.createdNeedsTranslation', '{language} variation created — needs translation', { language: target.english })
          : t('email:editor.languages.created', '{language} variation created', { language: target.english }),
      });
      openDocument(created.id);
    } catch (error) {
      // It exists after all (created meanwhile, or archived): open it instead.
      const existingId = error instanceof ApiError && error.status === 409 ? readExistingId(error) : null;
      if (existingId !== null) openDocument(existingId);
      else failToast(t('email:editor.languages.addFailed', 'Could not add that language'), error);
    } finally {
      setAddingLocale(null);
    }
  };

  // --- the inspector's panel for the selection --------------------------------------
  const brand = effectiveBrand(draft.document.brand, branding.appName, 'var(--accent)');
  const languages = languageRows(detail.locale, detail.languages);
  const designHeader: DesignHeader =
    selection.kind === 'block'
      ? selectedBlock === null
        ? { icon: 'mail', title: t('email:inspector.hints.gone', 'Section removed'), hint: '' }
        : { icon: blockDef(selectedBlock.block).icon, title: blockLabel(selectedBlock.block), hint: blockHint(selectedBlock.block) }
      : selection.kind === 'subject'
        ? { icon: 'type', title: t('email:inspector.titles.subject', 'Subject'), hint: t('email:inspector.hints.subject', 'Subject & preview text') }
        : selection.kind === 'footer'
          ? { icon: 'panel-bottom', title: t('email:canvas.sections.footer', 'Footer'), hint: t('email:inspector.hints.footer', 'Legal & unsubscribe') }
          : selection.kind === 'attach'
            ? { icon: 'paperclip', title: t('email:canvas.sections.attachments', 'Attachments'), hint: t('email:inspector.hints.attachments', 'Fixed files & generated files') }
            : { icon: 'pencil-ruler', title: t('email:canvas.sections.branding', 'Brand & sender'), hint: t('email:inspector.hints.branding', 'Logo, from, colour, status') };

  const rowsField = selectedBlock === null ? '' : (blockDef(selectedBlock.block).rows?.field ?? '');
  const panel =
    selection.kind === 'block' && selectedBlock !== null ? (
      <BlockPanel
        block={selectedBlock}
        def={blockDef(selectedBlock.block)}
        vars={detail.vars}
        onField={(key, value) => edits.setBlockField(selectedBlock.id, key, value)}
        onFocusField={(key) => {
          actions.beginEdit();
          setActiveField({ kind: 'field', id: selectedBlock.id, key });
        }}
        onRowCell={(index, key, value) => edits.setBlockRow(selectedBlock.id, rowsField, index, key, value)}
        onFocusRowCell={(index, key) => {
          actions.beginEdit();
          setActiveField({ kind: 'cell', id: selectedBlock.id, field: rowsField, index, key });
        }}
        onAddRow={() => edits.addBlockRow(selectedBlock.id, rowsField)}
        onDuplicateRow={(index) => edits.dupBlockRow(selectedBlock.id, rowsField, index)}
        onRemoveRow={(index) => edits.delBlockRow(selectedBlock.id, rowsField, index)}
        onMoveRow={(from, to) => edits.moveBlockRow(selectedBlock.id, rowsField, from, to)}
        onInsertVar={edits.insertVar}
        onStyle={(patch) => edits.setBlockStyle(selectedBlock.id, patch)}
        onSaveBlock={async (name) => {
          await saveBlock.mutateAsync({ name, block: selectedBlock }).catch(() => undefined);
        }}
        onDuplicate={() => dupBlockAt(selectedBlock.id)}
        onRemove={() => delBlockAt(selectedBlock.id)}
        onChooseImage={() => setImagePickFor(selectedBlock.id)}
        imagePickerAvailable
      />
    ) : selection.kind === 'subject' ? (
      <SubjectPanel
        subject={draft.document.subject}
        preheader={draft.document.preheader}
        vars={detail.vars}
        onSubjectFocus={() => {
          actions.beginEdit();
          setActiveField({ kind: 'subject' });
        }}
        onSubjectChange={edits.setSubject}
        onPreheaderFocus={() => {
          actions.beginEdit();
          setActiveField({ kind: 'preheader' });
        }}
        onPreheaderChange={edits.setPreheader}
        onInsertVar={edits.insertVar}
      />
    ) : selection.kind === 'footer' ? (
      <FooterPanel footer={draft.document.footer} onFocus={() => actions.beginEdit()} onChange={edits.setFooter} />
    ) : selection.kind === 'attach' ? (
      <AttachmentsPanel
        attachments={draft.document.attachments}
        resolved={detail.attachmentsResolved}
        onGeneratedChange={edits.updateGeneratedAttachment}
        onRemove={edits.removeAttachment}
        onAddGenerated={edits.addGeneratedAttachment}
        documents={
          <WorkspaceDocuments
            attachedFileIds={new Set(draft.document.attachments.flatMap((a) => (a.kind === 'file' ? [a.fileId] : [])))}
            onAttach={(file) => {
              edits.addFileAttachment(file.id);
              toasts.push({ variant: 'success', title: t('email:inspector.attached', '{name} attached', { name: file.filename }) });
            }}
          />
        }
      />
    ) : (
      <BrandingPanel
        brand={brand}
        storedAccent={draft.document.brand?.accent ?? null}
        logoUrl={branding.logoUrl}
        senders={senders}
        kind={detail.kind}
        category={draft.category}
        enabled={draft.enabled}
        campaignStatus={statusOf({ ...detail, enabled: draft.enabled })}
        languages={languages}
        topicLabel={detail.topicLabel}
        onBrand={(patch) => edits.setBrand(brand, patch, !('name' in patch || 'fromName' in patch))}
        onFocus={() => actions.beginEdit()}
        onCategory={(category) => actions.histMutate({ category })}
        onEnabled={(enabled) => actions.histMutate({ enabled })}
        onOpenLanguage={openDocument}
        onAddLanguage={(locale) => {
          void addLanguage(locale);
        }}
      />
    );

  const name = draft.name;
  const shownName = name.trim() === '' ? detail.name : name;
  const pickerAbove = picker === null ? null : (blocks[picker.index] ?? null);

  return (
    <>
      <PageActions
        title={shownName}
        subtitle={draft.document.subject}
        documentTitle={`${shownName} · ${t('email:title', 'Email templates')}`}
        backTo="/email-templates"
      />
      <PageSurface width="full" padding="none" testId="email-editor">
        <div style={{ '--adm-topbar-h': stickyOffsets.topbar, '--adm-editor-header-h': stickyOffsets.header }} className="flex min-h-0 flex-1 flex-col">
          <EditorHeader
            ref={headerRef}
          kind={detail.kind}
          name={name}
          locale={detail.locale}
          languages={detail.languages}
          status={state.status}
          error={state.error}
          canUndo={state.canUndo}
          canRedo={state.canRedo}
          addingLocale={addingLocale}
          onNameFocus={() => actions.beginEdit()}
          onNameChange={(value) => actions.mutate({ name: value })}
          onOpenLanguage={openDocument}
          onAddLanguage={(locale) => {
            void addLanguage(locale);
          }}
          onUndo={actions.undo}
          onRedo={actions.redo}
          onDuplicate={() => duplicate.mutate()}
          onDelete={() => setConfirmDelete(true)}
          onTest={() => setTestOpen(true)}
          onSave={() => {
            void save();
          }}
          onSend={() => setSendOpen(true)}
          testAvailable
          sendAvailable={detail.kind === 'campaign' && detail.archivedAt === null && activeRun === null}
          run={detail.run}
          progress={progress}
          localeTag={localeTag}
          onCancelRun={() => {
            if (activeRun !== null) cancelRun.mutate(activeRun);
          }}
          cancelling={cancelRun.isPending}
          askAssistant={<AskAssistant host={assistantHost} slot="editor" />}
        />
        <div className="flex min-h-0 flex-1 items-start">
          <main data-testid="email-canvas" className="min-w-0 flex-1 bg-bg px-7 pb-[60px] pt-[22px]">
            <EmailCanvas
              document={draft.document}
              dir={isLocaleId(detail.locale) ? dirForLocale(detail.locale) : 'ltr'}
              vars={detail.vars}
              attachmentsResolved={detail.attachmentsResolved}
              appName={branding.appName}
              accent="var(--accent)"
              logoUrl={branding.logoUrl}
              files={files}
              selection={selection}
              device={device}
              onSelect={selectFor}
              onDeviceChange={setDevice}
              onSubjectFocus={() => {
                actions.beginEdit();
                selectFor({ kind: 'subject' });
                setActiveField({ kind: 'subject' });
              }}
              onSubjectChange={edits.setSubject}
              onPreheaderFocus={() => {
                actions.beginEdit();
                selectFor({ kind: 'subject' });
                setActiveField({ kind: 'preheader' });
              }}
              onPreheaderChange={edits.setPreheader}
              onHeadingFocus={(id) => {
                actions.beginEdit();
                selectFor({ kind: 'block', id });
                setActiveField({ kind: 'heading', id });
              }}
              onHeadingChange={(id, text) => edits.setBlockField(id, 'text', text)}
              onInsertAt={(index) => setPicker({ index })}
            />
          </main>
          <Inspector
            tab={inspectorTab}
            onTabChange={setInspectorTab}
            sections={{
              blocks,
              selection,
              attachmentCount: draft.document.attachments.length,
              savedBlocks,
              onSelect: selectFor,
              onDuplicateBlock: dupBlockAt,
              onRemoveBlock: delBlockAt,
              onMoveBlock: moveBlock,
              onAddSection: () => setPicker({ index: blocks.length }),
              onInsertSaved: (saved) => insertBlock(savedToBlock(saved), blocks.length, saved.name),
            }}
            design={designHeader}
            panel={panel}
          />
        </div>
        </div>
      </PageSurface>

      {picker === null ? null : (
        <BlockPicker
          index={picker.index < blocks.length ? picker.index : null}
          aboveLabel={pickerAbove === null ? null : blockLabel(pickerAbove.block)}
          onClose={() => setPicker(null)}
          onPickKind={pickKind}
          onPickSaved={pickSaved}
        />
      )}
      {mirror === null ? null : (
        <MirrorModal
          label={mirror.label}
          topicLabel={detail.topicLabel}
          native={facts.native}
          siblingCount={liveSiblings}
          onOnlyThis={() => setMirror(null)}
          onApplyAll={() => {
            actions.queueMirrorOp(mirror.op);
            setMirror(null);
            toasts.push({
              variant: 'info',
              title: t('email:mirror.queued', 'Queued for {count, plural, one {# other language} other {# other languages}} — applies when you save', {
                count: liveSiblings,
              }),
            });
          }}
        />
      )}
      {testOpen ? (
        <TestSendModal
          documentName={shownName}
          subject={draft.document.subject}
          firstVar={detail.vars[0] ?? null}
          teammates={teammates}
          onSend={sendTest}
          onClose={() => setTestOpen(false)}
        />
      ) : null}
      {sendOpen ? (
        <SendCampaignModal documentId={detail.id} documentName={shownName} subject={draft.document.subject} onSend={sendCampaign} onClose={() => setSendOpen(false)} />
      ) : null}
      {imagePickFor === null ? null : (
        <ImagePicker
          onClose={() => setImagePickFor(null)}
          onPick={(pick) => {
            const id = imagePickFor;
            setImagePickFor(null);
            edits.patchBlock(
              id,
              (block) => ({
                ...block,
                data: {
                  ...block.data,
                  ...('fileId' in pick ? { fileId: pick.fileId, url: '' } : { url: pick.url, fileId: null }),
                  ...(pick.alt === '' ? {} : { alt: pick.alt }),
                },
              }),
              true,
            );
          }}
        />
      )}
      {blocker.status === 'blocked' ? <DiscardChangesModal name={shownName} onKeep={() => blocker.reset()} onDiscard={() => blocker.proceed()} /> : null}
      {confirmDelete ? (
        <DeleteModal mode="archive" kind={detail.kind} name={shownName} busy={archive.isPending} onCancel={() => setConfirmDelete(false)} onConfirm={() => archive.mutate()} />
      ) : null}
    </>
  );
}

function readExistingId(error: ApiError): string | null {
  const details = error.details;
  if (typeof details !== 'object' || details === null) return null;
  const id = (details as Record<string, unknown>)['existingId'];
  return typeof id === 'string' && id !== '' ? id : null;
}
