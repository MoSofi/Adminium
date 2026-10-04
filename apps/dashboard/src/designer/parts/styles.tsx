// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Picking a style for a new app, and adding a style of one's own.
 *
 * The picker sits beside the model on the home page: "Let the Designer
 * choose" first, then every style there is, then "Add your own…". A style of
 * the project's own can be removed from here: its folder is deleted, and an
 * app that uses it keeps the look it has.
 *
 * Adding takes a .zip of a style's folder or one SKILL.md. The server checks
 * it and says, in a sentence, why a file was not taken.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, CircleAlert, CircleCheck, LoaderCircle, Palette, Plus, Trash2, Upload } from 'lucide-react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { designerApi, designerKeys, type DesignerStyle } from '../api.js';
import { StyleSwatch } from './look.js';

/** A style's own small picture when it has one, else its three colours. */
export function StyleTile({ entry }: { entry: Pick<DesignerStyle, 'key' | 'hasPreview' | 'swatch'> }): ReactNode {
  if (!entry.hasPreview) return <StyleSwatch swatch={entry.swatch} />;
  return <img src={designerApi.stylePreviewUrl(entry.key)} alt="" className="h-[30px] w-[42px] shrink-0 rounded-md border border-border-strong object-cover" />;
}

export const stylesQuery = () => ({ queryKey: designerKeys.styles, queryFn: designerApi.styles, staleTime: 60_000 });

export function AddStyleDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded?: (key: string) => void }): ReactNode {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: (file: File) => designerApi.addStyle(file),
    onSuccess: (added) => {
      void queryClient.invalidateQueries({ queryKey: designerKeys.styles });
      onAdded?.(added.key);
    },
  });
  const take = (file: File | undefined): void => {
    if (file === undefined) return;
    setName(file.name);
    add.mutate(file);
  };
  const close = (): void => {
    add.reset();
    setName('');
    onClose();
  };
  return (
    <Modal open={open} onOpenChange={(next) => (next ? undefined : close())} className="max-w-[520px] max-sm:inset-0 max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none">
      <ModalHeader icon={<Palette />} title={t('designer:style.addTitle', 'Add a style of your own')} closeLabel={t('designer:model.close', 'Close')} />
      <ModalBody className="flex flex-col gap-4 pt-1">
        <p className="m-0 text-[13px] leading-normal text-fg-muted">
          {t('designer:style.addLead', 'A style is a folder with a SKILL.md file that describes a look. It may also hold colours and fonts (theme.json), a stylesheet, a preview picture and font files.')}
        </p>
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            take(event.dataTransfer.files[0]);
          }}
          className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface-2 px-4 py-6 text-center"
        >
          <Upload aria-hidden="true" className="size-5 text-fg-subtle" />
          <p className="m-0 text-[13px] font-semibold text-fg">{t('designer:style.addDrop', 'Drop a .zip of the folder or a single SKILL.md here')}</p>
          <input ref={input} type="file" accept=".zip,.md,application/zip,text/markdown" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => take(event.target.files?.[0])} />
          <Button
            variant="secondary"
            size="sm"
            disabled={add.isPending}
            onClick={() => {
              if (input.current !== null) input.current.value = '';
              input.current?.click();
            }}
          >
            {add.isError ? t('designer:style.addAgain', 'Choose another file') : t('designer:style.addChoose', 'Choose a file')}
          </Button>
        </div>
        {add.isPending ? (
          <p role="status" className="m-0 flex items-center gap-2 text-[13px] text-fg-muted">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-accent" />
            <span dir="auto" className="font-mono text-[12px]">
              {name}
            </span>
            {t('designer:style.addChecking', 'Checking…')}
          </p>
        ) : null}
        {add.isSuccess ? (
          <div role="status" className="flex flex-col gap-1 rounded-lg border border-border-strong bg-surface p-3 text-[13px]">
            <p className="m-0 flex items-center gap-2 font-semibold text-fg">
              <CircleCheck aria-hidden="true" className="size-4 text-accent" />
              <span dir="auto" className="font-mono text-[12px]">
                {add.data.key}
              </span>
              {t('designer:style.added', 'Added. It is in the list now.')}
            </p>
            {add.data.left.length === 0 ? null : (
              <p dir="auto" className="m-0 text-[12px] text-fg-muted">
                {t('designer:style.addLeft', 'Left out, as no part of a style: {list}', { list: add.data.left.join(', ') })}
              </p>
            )}
          </div>
        ) : null}
        {add.isError ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft p-3 text-[13px] text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <strong>{t('designer:style.addFailed', 'The style was not added')}</strong>
              <span dir="auto">{add.error instanceof ApiError || add.error instanceof Error ? add.error.message : String(add.error)}</span>
            </span>
          </div>
        ) : null}
        <p className="m-0 text-[12px] leading-normal text-fg-subtle">{t('designer:style.addNote', 'It is saved in your project’s design-skills folder. Scripts in it are never run.')}</p>
      </ModalBody>
      <ModalFooter>
        <Button variant={add.isSuccess ? 'primary' : 'secondary'} onClick={close}>
          {t('designer:style.addDone', 'Done')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** "Remove …?" for a style of the project's own. */
export function RemoveStyleDialog({ target: style, onClose, onRemoved }: { target: DesignerStyle | null; onClose: () => void; onRemoved?: (key: string) => void }): ReactNode {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (key: string) => designerApi.removeStyle(key),
    onSuccess: (_reply, key) => {
      void queryClient.invalidateQueries({ queryKey: designerKeys.styles });
      onRemoved?.(key);
      onClose();
    },
  });
  return (
    <Modal open={style !== null} onOpenChange={(next) => (next ? undefined : onClose())} className="max-w-[440px]">
      <ModalHeader icon={<Trash2 />} title={t('designer:style.removeTitle', 'Remove “{style}”?', { style: style?.title ?? '' })} closeLabel={t('designer:model.close', 'Close')} />
      <ModalBody className="flex flex-col gap-3 pt-1">
        <p className="m-0 text-[13px] leading-normal text-fg-muted">{t('designer:style.removeBody', 'Its folder is deleted from the project. Apps that use it keep the look they have.')}</p>
        {remove.isError ? (
          <p role="alert" className="m-0 text-[13px] font-semibold text-danger">
            {t('designer:style.removeFailed', 'The style could not be removed')}
          </p>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          {t('designer:style.removeNo', 'Keep it')}
        </Button>
        <Button variant="destructive" disabled={remove.isPending || style === null} onClick={() => (style === null ? undefined : remove.mutate(style.key))}>
          {t('designer:style.removeYes', 'Remove')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/**
 * The style of a new app, beside its model: "Let the Designer choose" unless
 * a person picks one. `value` is a style's key, or null.
 */
export function StylePicker({ value, disabled, onChange }: { value: string | null; disabled: boolean; onChange: (key: string | null) => void }): ReactNode {
  const styles = useQuery(stylesQuery());
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<DesignerStyle | null>(null);
  const all = styles.data?.styles ?? [];
  const picked = all.find((style) => style.key === value) ?? null;
  const name = picked?.title ?? t('designer:style.auto', 'Let the Designer choose');
  const row = (style: DesignerStyle): ReactNode => (
    <DropdownMenuItem
      key={`${style.origin}:${style.key}`}
      icon={<StyleTile entry={style} />}
      disabled={style.problem !== undefined}
      onSelect={() => onChange(style.key)}
      trailing={style.key === value ? <Check aria-hidden="true" className="text-accent" /> : undefined}
    >
      <span className="flex min-w-0 flex-col py-0.5">
        <span>{style.title}</span>
        <span className="whitespace-normal text-[11.5px] font-normal leading-snug text-fg-subtle">
          {style.problem !== undefined ? t('designer:style.problem', 'Cannot be used: {why}', { why: style.problem }) : style.description === '' ? t('designer:style.fromProject', 'From this project') : style.description}
        </span>
      </span>
    </DropdownMenuItem>
  );
  const own = all.filter((style) => style.origin === 'project');
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label={t('designer:style.pick', 'Style: {style}', { style: name })}
          className="flex h-[34px] min-w-0 shrink items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-bold text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Palette aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
          <span className="truncate">{picked === null ? t('designer:style.auto', 'Let the Designer choose') : picked.title}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[min(70vh,560px)] w-[360px] overflow-y-auto" aria-label={t('designer:style.menu', 'The style of the screens')}>
          <DropdownMenuItem icon={<Palette />} onSelect={() => onChange(null)} trailing={value === null ? <Check aria-hidden="true" className="text-accent" /> : undefined}>
            <span className="flex min-w-0 flex-col py-0.5">
              <span>{t('designer:style.auto', 'Let the Designer choose')}</span>
              <span className="whitespace-normal text-[11.5px] font-normal leading-snug text-fg-subtle">{t('designer:style.autoLine', 'It picks what suits the business, and you can change it afterwards.')}</span>
            </span>
          </DropdownMenuItem>
          {all.filter((style) => style.origin === 'built-in').map(row)}
          {own.length === 0 ? null : <DropdownMenuLabel>{t('designer:style.yours', 'Yours')}</DropdownMenuLabel>}
          {own.map((style) => (
            <div key={style.key} className="flex items-center">
              <div className="min-w-0 flex-1">{row(style)}</div>
              <button
                type="button"
                onClick={() => setRemoving(style)}
                aria-label={t('designer:style.remove', 'Remove {style}…', { style: style.title })}
                title={t('designer:style.remove', 'Remove {style}…', { style: style.title })}
                className="me-1 flex size-7 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-danger"
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
              </button>
            </div>
          ))}
          <DropdownMenuItem icon={<Plus />} onSelect={() => setAdding(true)}>
            {t('designer:style.addOwn', 'Add your own…')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddStyleDialog open={adding} onClose={() => setAdding(false)} onAdded={(key) => onChange(key)} />
      <RemoveStyleDialog
        target={removing}
        onClose={() => setRemoving(null)}
        // The picked style is gone: the choice goes back to the Designer.
        onRemoved={(key) => (key === value ? onChange(null) : undefined)}
      />
    </>
  );
}
