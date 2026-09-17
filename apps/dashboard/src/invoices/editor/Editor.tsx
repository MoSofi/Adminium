// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The invoice editor: the header, the canvas and the
 * inspector over ONE draft that only `save()` sends (O22 → model).
 *
 * THE GUARD. A router blocker asks before any navigation away from a dirty
 * draft — the topbar's Back, the sidebar, a language switch, the browser's
 * own back — and `beforeunload` covers the tab. One navigation bypasses it
 * on purpose: the one that follows a delete (the row is gone; an unsaved
 * edit to it has nowhere to go). The comp has no guard because it
 * autosaves; the explicit-save model forces this addition.
 *
 * SELECTION drives the inspector (the comp's `selSection`, 1044): picking a
 * region on the sheet, a header button (Images) or a modal pick sets it;
 * removing a custom section or hiding a block falls back to `items` (1322,
 * 1361). The Add-section modal remembers WHERE it was opened from
 * (`addOpen.at`, the comp's `addAt` 1283): a between-block chip's pre-filter
 * index, or `null` to append.
 *
 * `totals` is derived ONCE here and handed to every consumer (the
 * ladder, the QR block, the recurring banner, the multi-currency rows, the
 * tax breakdown and the inspector's Items panel). `Ctrl/⌘+S` saves, inside a
 * field too (`mod+s` is on the shortcut manager's typing allowlist).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { useShortcut } from '../../shell/ShortcutsProvider.js';
import { invoicesApi, type InvoiceDetail } from '../api.js';
import { DeleteModal } from '../manager/DeleteModal.js';
import { customKeyOf, type OptionalSection, type SectionKey } from '../model/blocks.js';
import type { CustomSectionType } from '../model/envelope.js';
import type { InvoiceLang } from '../model/languages.js';
import { totalsOf } from '../model/money.js';
import { invalidateInvoices } from '../queries.js';
import { InvoiceCanvas } from './canvas/InvoiceCanvas.js';
import type { ImageRejection } from './canvas/inline.js';
import { EditorHeader } from './EditorHeader.js';
import { IMAGE_MAX_LABEL } from './images.js';
import { Inspector } from './inspector/Inspector.js';
import { AddSectionModal } from './overlays/AddSectionModal.js';
import { DiscardChangesModal } from './overlays/DiscardChangesModal.js';
import { useDocumentEdits } from './useDocumentEdits.js';
import { useEditorDraft } from './useEditorDraft.js';
import { useProvider } from './useProvider.js';

export interface EditorProps {
  detail: InvoiceDetail;
}

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

function readExistingId(error: ApiError): string | null {
  const details = error.details;
  if (typeof details !== 'object' || details === null) return null;
  const id = (details as Record<string, unknown>)['existingId'];
  return typeof id === 'string' && id !== '' ? id : null;
}

export function Editor({ detail }: EditorProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const provider = useProvider();
  const [state, actions] = useEditorDraft(detail);
  const edits = useDocumentEdits(actions);
  const [section, setSection] = useState<SectionKey>('branding');
  const [addOpen, setAddOpen] = useState<{ at: number | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingLang, setAddingLang] = useState<InvoiceLang | null>(null);
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

  const draft = state.draft;
  const totals = useMemo(() => totalsOf(draft.body), [draft.body]);

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
      failToast(t('invoices:editor.saveFailed', 'Could not save'), error);
    }
  }, [actions, failToast, state.status]);

  useShortcut({
    id: 'invoices-save',
    group: 'Editing',
    label: t('invoices:editor.shortcutSave', 'Save the document'),
    keys: ['⌘', 'S'],
    handler: () => {
      void save();
    },
  });

  // --- the header's actions ------------------------------------------------------
  const kind = detail.kind;
  const openDocument = (id: string) => {
    void navigate({ to: '/invoices/$id', params: { id } });
  };

  const duplicate = useMutation({
    mutationFn: () => invoicesApi.duplicate(detail.id),
    onSuccess: (copy) => {
      void invalidateInvoices(queryClient);
      toasts.push({
        variant: 'success',
        title: kind === 'template' ? t('invoices:toast.duplicated.template', 'Template duplicated') : t('invoices:toast.duplicated.invoice', 'Invoice duplicated'),
        action: {
          label: t('common.undo', 'Undo'),
          onAction: () => {
            invoicesApi
              .remove(copy.id)
              .then(() => invalidateInvoices(queryClient))
              .catch((error: unknown) => failToast(t('undo.failed', 'Could not undo this change'), error));
          },
        },
      });
    },
    onError: (error) => failToast(t('invoices:toast.duplicateFailed', 'Could not duplicate it'), error),
  });

  const remove = useMutation({
    mutationFn: () => invoicesApi.remove(detail.id),
    onSuccess: () => {
      setConfirmDelete(false);
      void invalidateInvoices(queryClient);
      bypassGuard.current = true;
      void navigate({ to: '/invoices', search: { kind } });
    },
    onError: (error) => {
      setConfirmDelete(false);
      failToast(t('invoices:toast.deleteFailed', 'Could not delete it'), error);
    },
  });

  const addLanguage = async (lang: InvoiceLang) => {
    setAddingLang(lang);
    try {
      const created = await invoicesApi.addLanguage(detail.id, lang);
      void invalidateInvoices(queryClient);
      openDocument(created.id);
    } catch (error) {
      // It exists after all (created meanwhile): open it instead (comp 1242-1243).
      const existingId = error instanceof ApiError && error.status === 409 ? readExistingId(error) : null;
      if (existingId !== null) openDocument(existingId);
      else failToast(t('invoices:toast.languageFailed', 'Could not add that language'), error);
    } finally {
      setAddingLang(null);
    }
  };

  // --- images, sections ---------------------------------------------------------------
  const onImageRejected = useCallback(
    (result: ImageRejection) => {
      toasts.push({
        variant: 'error',
        title:
          result.reason === 'tooLarge'
            ? t('invoices:toast.imageTooLarge', 'Image too large (max {max})', { max: IMAGE_MAX_LABEL })
            : result.reason === 'notImage'
              ? t('invoices:toast.notAnImage', 'That file is not an image')
              : t('invoices:toast.imageUnreadable', 'Could not read that file'),
      });
    },
    [toasts],
  );

  const pickCustom = (type: CustomSectionType) => {
    if (addOpen === null) return;
    const created = edits.addCustom(type, addOpen.at);
    setAddOpen(null);
    setSection(customKeyOf(created.id));
  };
  const pickBuiltin = (optional: OptionalSection) => {
    if (addOpen === null) return;
    edits.addBuiltin(optional.block, optional.flag, addOpen.at);
    setAddOpen(null);
    setSection(optional.section);
  };
  const removeCustom = (id: string) => {
    edits.removeCustom(id);
    setSection('items');
  };

  const name = draft.name;
  const shownName = name.trim() === '' ? detail.name : name;
  const number = draft.body.number.trim();

  const inspectorProps = {
    section,
    draft,
    edits,
    totals,
    onSelect: setSection,
    onOpenAdd: () => setAddOpen({ at: null }),
    onImageRejected,
  };

  return (
    <>
      <PageActions
        title={shownName}
        subtitle={kind === 'invoice' && number !== '' ? number : undefined}
        documentTitle={`${shownName} · ${t('invoices:manager.title', 'Invoices')}`}
        backTo="/invoices"
      />
      <PageSurface width="full" padding="none" testId="invoices-editor">
        <div style={{ '--adm-topbar-h': stickyOffsets.topbar, '--adm-editor-header-h': stickyOffsets.header }} className="flex min-h-0 flex-1 flex-col">
          <EditorHeader
            ref={headerRef}
            kind={kind}
            name={name}
            lang={draft.lang}
            languages={detail.languages}
            status={state.status}
            error={state.error}
            canUndo={state.canUndo}
            canRedo={state.canRedo}
            addingLang={addingLang}
            providerInstalled={provider.installed}
            onNameFocus={() => actions.beginEdit()}
            onNameChange={edits.setName}
            onOpenLanguage={openDocument}
            onCreateLanguage={(lang) => {
              void addLanguage(lang);
            }}
            onUndo={actions.undo}
            onRedo={actions.redo}
            onImages={() => setSection('images')}
            onDuplicate={() => duplicate.mutate()}
            onDelete={() => setConfirmDelete(true)}
            // With no provider installed the primary only saves (O24);
            // The provider read flips the label to *Send invoice* and
            // wires the render + delivery behind it.
            onPrimary={() => {
              void save();
            }}
          />
          <div className="flex min-h-0 flex-1 items-start">
            <main className="min-w-0 flex-1 bg-bg px-7 pb-[60px] pt-[30px]">
              <InvoiceCanvas
                draft={draft}
                totals={totals}
                edits={edits}
                section={section}
                onSelect={setSection}
                onInsertAt={(index) => setAddOpen({ at: index })}
                onAppend={() => setAddOpen({ at: null })}
                onRemoveCustom={removeCustom}
                onImageRejected={onImageRejected}
              />
              <div className="mt-6 lg:hidden">
                <Inspector {...inspectorProps} variant="drawer" />
              </div>
            </main>
            <Inspector {...inspectorProps} />
          </div>
        </div>
      </PageSurface>

      {addOpen === null ? null : <AddSectionModal body={draft.body} onClose={() => setAddOpen(null)} onPickCustom={pickCustom} onPickBuiltin={pickBuiltin} />}
      {blocker.status === 'blocked' ? <DiscardChangesModal name={shownName} onKeep={() => blocker.reset()} onDiscard={() => blocker.proceed()} /> : null}
      {confirmDelete ? <DeleteModal kind={kind} name={shownName} busy={remove.isPending} onCancel={() => setConfirmDelete(false)} onConfirm={() => remove.mutate()} /> : null}
    </>
  );
}
