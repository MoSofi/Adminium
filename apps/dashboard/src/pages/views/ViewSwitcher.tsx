/**
 * Saved-views switcher for the page-crud toolbar (M5-T06). A dropdown that
 * lists the caller's views (+ shared), applies one (round-tripping the grid
 * state exactly), saves the current grid as a new view, and renames / sets
 * default / deletes the active view (delete is type-to-confirm). The binding
 * owns the query + mutations and the applied-view remount; this stays
 * presentational.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Check, ListFilter, Pencil, Plus, RotateCcw, Star, Trash2 } from 'lucide-react';
import {
  Button,
  ConfirmModal,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { SavedView } from './viewsApi.js';

export interface ViewSwitcherProps {
  views: SavedView[];
  activeViewId: string | null;
  disabled?: boolean;
  onApply: (view: SavedView | null) => void;
  onSaveNew: (name: string) => Promise<void>;
  onUpdate: (view: SavedView) => Promise<void>;
  onRename: (view: SavedView, name: string) => Promise<void>;
  onDelete: (view: SavedView) => Promise<void>;
  onSetDefault: (view: SavedView) => Promise<void>;
}

/** Small controlled name-entry modal shared by "save" and "rename". */
function NameModal({
  open,
  title,
  submitLabel,
  initialValue,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  initialValue: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}): ReactNode {
  const [name, setName] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialValue);
      setError(null);
      setBusy(false);
    }
  }, [open, initialValue]);

  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setError(t('views.nameRequired', 'Enter a name for this view.'));
      return;
    }
    setBusy(true);
    onSubmit(trimmed)
      .then(() => onClose())
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : t('views.saveFailed', 'Could not save the view.'));
      })
      .finally(() => setBusy(false));
  };

  return (
    <Modal open={open} onOpenChange={(next) => !next && onClose()} size="sm">
      <ModalHeader icon={<ListFilter />} title={title} closeLabel={t('common.close', 'Close')} />
      <ModalBody>
        <label className="flex flex-col gap-1.5 text-body-sm font-medium text-fg">
          {t('views.nameLabel', 'View name')}
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('views.namePlaceholder', 'e.g. Active this month')}
            error={error !== null}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
          {error !== null ? <span className="text-caption text-danger">{error}</span> : null}
        </label>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {submitLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function ViewSwitcher({
  views,
  activeViewId,
  disabled = false,
  onApply,
  onSaveNew,
  onUpdate,
  onRename,
  onDelete,
  onSetDefault,
}: ViewSwitcherProps): ReactNode {
  const [saveOpen, setSaveOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SavedView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedView | null>(null);

  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  const triggerLabel = activeView?.name ?? t('views.baseView', 'All records');

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<ListFilter />}
            disabled={disabled}
            data-part="view-switcher-trigger"
          >
            {triggerLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuLabel>{t('views.menuLabel', 'Saved views')}</DropdownMenuLabel>

          <DropdownMenuItem
            icon={activeView === null ? <Check /> : undefined}
            onSelect={() => onApply(null)}
          >
            {t('views.baseView', 'All records')}
          </DropdownMenuItem>

          {views.map((view) => (
            <DropdownMenuItem
              key={view.id}
              icon={view.id === activeViewId ? <Check /> : undefined}
              trailing={view.isDefault ? <Star className="text-fg-subtle" aria-hidden /> : undefined}
              onSelect={() => onApply(view)}
            >
              {view.name}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuItem icon={<Plus />} onSelect={() => setSaveOpen(true)}>
            {t('views.saveAs', 'Save current as view…')}
          </DropdownMenuItem>

          {activeView !== null ? (
            <>
              <DropdownMenuItem
                icon={<RotateCcw />}
                onSelect={() => {
                  void onUpdate(activeView);
                }}
              >
                {t('views.updateActive', 'Update “{name}”', { name: activeView.name })}
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Pencil />} onSelect={() => setRenameTarget(activeView)}>
                {t('views.rename', 'Rename…')}
              </DropdownMenuItem>
              {activeView.isDefault ? null : (
                <DropdownMenuItem
                  icon={<Star />}
                  onSelect={() => {
                    void onSetDefault(activeView);
                  }}
                >
                  {t('views.setDefault', 'Set as default')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                icon={<Trash2 />}
                destructive
                onSelect={() => setDeleteTarget(activeView)}
              >
                {t('views.delete', 'Delete…')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <NameModal
        open={saveOpen}
        title={t('views.saveTitle', 'Save view')}
        submitLabel={t('views.save', 'Save view')}
        initialValue=""
        onSubmit={(name) => onSaveNew(name)}
        onClose={() => setSaveOpen(false)}
      />

      <NameModal
        open={renameTarget !== null}
        title={t('views.renameTitle', 'Rename view')}
        submitLabel={t('views.saveName', 'Save name')}
        initialValue={renameTarget?.name ?? ''}
        onSubmit={(name) => (renameTarget === null ? Promise.resolve() : onRename(renameTarget, name))}
        onClose={() => setRenameTarget(null)}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
        title={t('views.deleteTitle', 'Delete view')}
        body={t('views.deleteBody', 'This removes the saved view. Your data is not affected.')}
        confirmWord={deleteTarget?.name ?? ''}
        promptLabel={t('views.deletePrompt', 'Type the view name to confirm')}
        confirmLabel={t('views.deleteConfirm', 'Delete view')}
        cancelLabel={t('common.cancel', 'Cancel')}
        closeLabel={t('common.close', 'Close')}
        onConfirm={async () => {
          if (deleteTarget === null) return;
          await onDelete(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </>
  );
}
