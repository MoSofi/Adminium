// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The consent panel as the dashboard draws it: the house's own controls
 * (`Button`, `SegmentedControl`, `ChoiceChips`, `Textarea`) and its dialogs
 * over the page (`Modal` for a confirm, `FormDialog` for Record consent).
 *
 * In a file of their own, handed to the panel by the record page
 * (`RecordConsentPanel.tsx`): the panel itself is also an app's own screen's
 * (the kit), which must neither load these nor share them with the
 * dashboard's first load.
 */
import type { ReactNode } from 'react';
import { useMaybeT } from '@adminium/i18n/react';
import { Button, ChoiceChips, FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader, Modal, ModalFooter, ModalHeader, SegmentedControl, Textarea } from '@adminium/ui';

import type { ConfirmFrameProps, ConsentFrames, FormFrameProps, PanelButtonProps, PanelChoiceProps, PanelNoteProps } from './ConsentPanel.js';
import { Glyph } from './glyphs.js';

function HouseButton(props: PanelButtonProps): ReactNode {
  return (
    <Button
      variant={props.tone}
      type={props.type ?? 'button'}
      onClick={props.onClick}
      loading={props.busy === true}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
      aria-describedby={props.describedBy}
      data-testid={props.testId}
      {...(props.className === undefined ? {} : { className: props.className })}
    >
      {props.children}
    </Button>
  );
}

function HouseChoice({ kind, labelledBy, value, options, onChange }: PanelChoiceProps): ReactNode {
  if (kind === 'segments') {
    return <SegmentedControl aria-labelledby={labelledBy} className="self-start" value={value} onValueChange={onChange} options={options} data-first />;
  }
  return (
    <ChoiceChips
      aria-labelledby={labelledBy}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
      options={options}
    />
  );
}

function HouseNote({ id, value, onChange, testId }: PanelNoteProps): ReactNode {
  return <Textarea id={id} rows={3} maxLength={1000} value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} />;
}

function DialogConfirm(props: ConfirmFrameProps): ReactNode {
  const t = useMaybeT();
  return (
    <Modal
      open
      size="sm"
      role="alertdialog"
      className="max-w-[420px]"
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onCancel();
      }}
    >
      <div data-testid={props.testId}>
        <ModalHeader
          icon={<Glyph name={props.glyph} />}
          tone={props.tone}
          hideClose
          closeLabel={t('common:consent.dialog.close', 'Close')}
          title={props.title}
          subtitle={<span className="mx-auto mt-2 block max-w-[320px] text-body text-fg-muted">{props.body}</span>}
          className="flex-col items-center px-6 pb-5 pt-6 text-center [&>*:first-child]:mb-1.5 [&>*:first-child]:size-[52px] [&>*:first-child]:rounded-lg [&>*:first-child_svg]:size-6"
        />
        <ModalFooter className="gap-2.5 [&>button]:flex-1">{props.buttons}</ModalFooter>
      </div>
    </Modal>
  );
}

function DialogForm(props: FormFrameProps): ReactNode {
  const t = useMaybeT();
  return (
    <FormDialog
      open
      width={560}
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onCancel();
      }}
    >
      <form onSubmit={props.onSubmit} data-testid={props.testId}>
        <FormDialogHeader icon={<Glyph name="filePen" />} title={props.title} {...(props.subtitle === null ? {} : { subtitle: props.subtitle })} closeLabel={t('common:consent.dialog.close', 'Close')} />
        <FormDialogBody className="flex flex-col gap-4">{props.fields}</FormDialogBody>
        <FormDialogFooter>{props.buttons}</FormDialogFooter>
      </form>
    </FormDialog>
  );
}

export const DIALOG_FRAMES: ConsentFrames = { Button: HouseButton, Choice: HouseChoice, Note: HouseNote, Confirm: DialogConfirm, Form: DialogForm, inline: false };
