// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The report editor (E1–E11): the header, the palette, the canvas and the
 * inspector over ONE draft that only `save()` sends (D4/O6, inheriting
 * model).
 *
 * THE GUARD. A router blocker asks before any navigation away from a dirty
 * draft — the topbar's Back, the sidebar, the browser's own back — and
 * `beforeunload` covers the tab. One navigation bypasses it on purpose: the
 * one that follows a delete (the row is gone; an unsaved edit to it has
 * nowhere to go). The comp has no guard because it autosaves (524); the
 * explicit-save model forces this addition (E4).
 *
 * SELECTION drives the inspector (the comp's `selBlock`, 443): clicking the
 * header region or a block card sets it, adding a block selects the new one
 * (535), deleting one falls back to `header` (538).
 *
 * *PUBLISH* (D5/O2) saves the draft AND sets `status: 'sent'` in the same PUT;
 * on an already-published report it just saves. A template's primary reads
 * *Save template* and only saves. `Ctrl/⌘+S` always saves without the status
 * change (`mod+s` is on the shortcut manager's typing allowlist).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { tagForLocale, type LocaleId } from '@adminium/i18n';
import { Button } from '@adminium/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { useShortcut } from '../../shell/ShortcutsProvider.js';
import { reportBuilderApi, type ReportDetail } from '../api.js';
import { reportIcon } from '../icons.js';
import { DeleteModal } from '../manager/DeleteModal.js';
import type { ReportBlockKind } from '../model/envelope.js';
import type { Selection } from '../model/ops.js';
import { invalidateReportDocuments } from '../queries.js';
import { EditorHeader } from './EditorHeader.js';
import { Palette, PaletteSheet } from './Palette.js';
import { IMAGE_MAX_LABEL } from './images.js';
import { ReportCanvas } from './canvas/ReportCanvas.js';
import type { ImageRejection } from './canvas/inline.js';
import { Inspector } from './inspector/Inspector.js';
import { DiscardChangesModal } from './overlays/DiscardChangesModal.js';
import { useDocumentEdits } from './useDocumentEdits.js';
import { useEditorDraft } from './useEditorDraft.js';

export interface EditorProps {
  detail: ReportDetail;
}

/**
 * The shell scrolls the page under a sticky topbar, so the editor's own
 * sticky header, palette and inspector need the topbar's height (and the
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
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const locale = tagForLocale((bootstrap?.prefs.locale ?? 'en_US') as LocaleId);

  const [state, actions] = useEditorDraft(detail);
  const [selection, setSelection] = useState<Selection>('header');
  const select = useCallback((next: Selection) => setSelection(next), []);
  const edits = useDocumentEdits({ actions, onSelect: select });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
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
  const kind = detail.kind;

  const failToast = useCallback(
    (title: string, error: unknown) => {
      toasts.push({ variant: 'error', title, description: error instanceof Error ? error.message : undefined });
    },
    [toasts],
  );

  const save = useCallback(
    async (override?: { status: 'sent' }) => {
      if (state.status === 'saving') return;
      try {
        await actions.save(override);
      } catch (error) {
        failToast(t('reportBuilder:toast.saveFailed', 'Couldn’t save {name}', { name: draft.name }), error);
      }
    },
    [actions, draft.name, failToast, state.status],
  );

  useShortcut({
    id: 'report-builder-save',
    group: 'Editing',
    label: t('reportBuilder:editor.shortcutSave', 'Save the document'),
    keys: ['⌘', 'S'],
    handler: () => {
      void save();
    },
  });

  /**
   * D5/O2. A template's primary saves. A report's *Publish* saves AND marks
   * the row *Published*; on an already-published report there is nothing to
   * change, so it just saves.
   */
  const onPrimary = () => {
    if (kind === 'report' && draft.status !== 'sent') {
      void save({ status: 'sent' }).then(() => {
        toasts.push({ variant: 'success', title: t('reportBuilder:toast.published', 'Published {name}', { name: draft.name }) });
      });
      return;
    }
    void save();
  };

  const duplicate = useMutation({
    mutationFn: () => reportBuilderApi.duplicate(detail.id),
    onSuccess: (copy) => {
      void invalidateReportDocuments(queryClient);
      toasts.push({
        variant: 'success',
        title: t('reportBuilder:toast.duplicated', 'Duplicated {name}', { name: draft.name }),
        action: {
          label: t('reportBuilder:toast.undo', 'Undo'),
          onAction: () => {
            reportBuilderApi
              .remove(copy.id)
              .then(() => invalidateReportDocuments(queryClient))
              .catch((error: unknown) => failToast(t('undo.failed', 'Could not undo this change'), error));
          },
        },
      });
    },
    onError: (error) => failToast(t('reportBuilder:toast.duplicateFailed', 'Couldn’t duplicate it'), error),
  });

  const remove = useMutation({
    mutationFn: () => reportBuilderApi.remove(detail.id),
    onSuccess: () => {
      setConfirmDelete(false);
      void invalidateReportDocuments(queryClient);
      bypassGuard.current = true;
      void navigate({ to: '/report-builder', search: { kind } });
    },
    onError: (error) => {
      setConfirmDelete(false);
      failToast(t('reportBuilder:toast.deleteFailed', 'Couldn’t delete it'), error);
    },
  });

  const onImageRejected = useCallback(
    (result: ImageRejection) => {
      toasts.push({
        variant: 'error',
        title:
          result.reason === 'tooLarge'
            ? t('reportBuilder:inspector.backgroundTooLarge', 'Choose an image under {max}.', { max: IMAGE_MAX_LABEL })
            : result.reason === 'notImage'
              ? t('reportBuilder:toast.notAnImage', 'That file is not an image')
              : t('reportBuilder:toast.imageUnreadable', 'Couldn’t read that file'),
      });
    },
    [toasts],
  );

  const addBlock = (blockKind: ReportBlockKind) => {
    edits.addBlock(blockKind);
  };

  const name = draft.name;
  const shownName = name.trim() === '' ? detail.name : name;
  const PlusGlyph = reportIcon('plus');
  const inspectorProps = { body: draft.body, status: draft.status, selection, edits, onImageRejected };

  return (
    <>
      <PageActions
        title={shownName}
        subtitle={draft.body.kicker.trim() === '' ? undefined : draft.body.kicker}
        documentTitle={`${shownName} · ${t('reportBuilder:manager.title', 'Reports')}`}
        backTo="/report-builder"
      />
      <PageSurface width="full" padding="none" testId="report-editor">
        <div style={{ '--adm-topbar-h': stickyOffsets.topbar, '--adm-editor-header-h': stickyOffsets.header }} className="flex min-h-0 flex-1 flex-col">
          <EditorHeader
            ref={headerRef}
            kind={kind}
            name={name}
            status={state.status}
            error={state.error}
            canUndo={state.canUndo}
            canRedo={state.canRedo}
            onNameFocus={() => actions.beginEdit()}
            onNameChange={edits.setName}
            onUndo={actions.undo}
            onRedo={actions.redo}
            onDuplicate={() => duplicate.mutate()}
            onDelete={() => setConfirmDelete(true)}
            onPrimary={onPrimary}
          />
          {/* `items-stretch` (the default), not `items-start`: the palette and the
              inspector paint the comp's full-height surface and side border, and
              only the panels inside them stick. */}
          <div className="flex min-h-0 flex-1">
            <Palette onAdd={addBlock} />
            <main className="min-w-0 flex-1 bg-bg px-7 pb-[60px] pt-[30px]">
              {/* D18: below `lg` the palette is a button and the sheet scrolls
                  inside its own column rather than reflowing to a width the comp
                  never drew. */}
              <div className="mb-4 lg:hidden">
                <Button variant="secondary" iconLeft={<PlusGlyph />} onClick={() => setPaletteOpen(true)} data-testid="report-add-block">
                  {t('reportBuilder:palette.title', 'Add block')}
                </Button>
              </div>
              <div className="overflow-x-auto">
                <ReportCanvas body={draft.body} edits={edits} selection={selection} locale={locale} />
              </div>
              <div className="mt-6 lg:hidden">
                <Inspector {...inspectorProps} variant="drawer" />
              </div>
            </main>
            <Inspector {...inspectorProps} />
          </div>
        </div>
      </PageSurface>

      {paletteOpen ? <PaletteSheet onAdd={addBlock} onClose={() => setPaletteOpen(false)} /> : null}
      {blocker.status === 'blocked' ? <DiscardChangesModal name={shownName} onKeep={() => blocker.reset()} onDiscard={() => blocker.proceed()} /> : null}
      {confirmDelete ? <DeleteModal kind={kind} name={shownName} busy={remove.isPending} onCancel={() => setConfirmDelete(false)} onConfirm={() => remove.mutate()} /> : null}
    </>
  );
}
