// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The selected block's panel (comp 704-769, Appendix A §E3): *Choose image*
 * for image kinds, the schema's fields, the rows editor, *Insert variable*,
 * the eight style axes, *Save as reusable block*, Duplicate / Remove.
 */
import { Bookmark, Copy, ImagePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, FormField, Input, Textarea } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import type { EmailBlockRecord, EmailBlockStyle } from '../../../api.js';
import type { EmailBlockDef } from '../../../model/blocks.js';
import { blockLabel } from '../../blockText.js';
import { fieldLabel } from '../fieldText.js';
import { Divider } from '../parts.js';
import { RowsEditor, type RowValue } from '../RowsEditor.js';
import { StyleOptions } from '../StyleOptions.js';
import { VariablesBox } from '../VariablesBox.js';

export interface BlockPanelProps {
  block: EmailBlockRecord;
  def: EmailBlockDef;
  vars: readonly string[];
  onField: (key: string, value: string) => void;
  onFocusField: (key: string) => void;
  onRowCell: (index: number, key: string, value: string) => void;
  onFocusRowCell: (index: number, key: string) => void;
  onAddRow: () => void;
  onDuplicateRow: (index: number) => void;
  onRemoveRow: (index: number) => void;
  onMoveRow: (from: number, to: number) => void;
  onInsertVar: (token: string) => void;
  onStyle: (patch: Partial<EmailBlockStyle>) => void;
  onSaveBlock: (name: string) => Promise<void>;
  onDuplicate: () => void;
  onRemove: () => void;
  onChooseImage: () => void;
  /** The image picker arrives with 39-T14; until then the button is disabled. */
  imagePickerAvailable: boolean;
}

function fieldValue(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export function BlockPanel({
  block,
  def,
  vars,
  onField,
  onFocusField,
  onRowCell,
  onFocusRowCell,
  onAddRow,
  onDuplicateRow,
  onRemoveRow,
  onMoveRow,
  onInsertVar,
  onStyle,
  onSaveBlock,
  onDuplicate,
  onRemove,
  onChooseImage,
  imagePickerAvailable,
}: BlockPanelProps) {
  const [saving, setSaving] = useState<{ name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const rows: readonly RowValue[] = def.rows === undefined ? [] : ((block.data[def.rows.field] as RowValue[] | undefined) ?? []);

  return (
    <div data-testid="email-block-panel" data-kind={block.block} className="flex flex-col gap-3.5">
      {block.block === 'email.image' ? (
        <Button iconLeft={<ImagePlus />} onClick={onChooseImage} disabled={!imagePickerAvailable} data-testid="email-choose-image">
          {t('email:inspector.chooseImage', 'Choose image')}
        </Button>
      ) : null}
      {def.fields.map((field) => (
        <FormField key={field.key} label={fieldLabel(field.label)}>
          {field.kind === 'area' ? (
            <Textarea
              rows={4}
              data-testid="email-field"
              data-field={field.key}
              value={fieldValue(block.data, field.key)}
              onFocus={() => onFocusField(field.key)}
              onChange={(event) => onField(field.key, event.target.value)}
              className="text-[12.5px]"
            />
          ) : (
            <Input
              mono={field.kind === 'mono'}
              data-testid="email-field"
              data-field={field.key}
              placeholder={fieldLabel(field.label)}
              value={fieldValue(block.data, field.key)}
              onFocus={() => onFocusField(field.key)}
              onChange={(event) => onField(field.key, event.target.value)}
            />
          )}
        </FormField>
      ))}
      {def.rows === undefined ? null : (
        <RowsEditor
          schema={def.rows}
          rows={rows}
          onCell={onRowCell}
          onFocusCell={onFocusRowCell}
          onAdd={onAddRow}
          onDuplicate={onDuplicateRow}
          onRemove={onRemoveRow}
          onMove={onMoveRow}
        />
      )}
      {def.vars ? <VariablesBox vars={vars} onInsert={onInsertVar} /> : null}
      <Divider />
      <StyleOptions blockStyle={block.style} sized={def.sized} onChange={onStyle} />
      <Divider />
      {saving === null ? (
        <Button variant="outline" size="sm" iconLeft={<Bookmark />} onClick={() => setSaving({ name: blockLabel(block.block) })} data-testid="email-save-block">
          {t('email:inspector.saveAsReusable', 'Save as reusable block')}
        </Button>
      ) : (
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const name = saving.name.trim() === '' ? t('email:inspector.myBlock', 'My block') : saving.name.trim();
            setBusy(true);
            void onSaveBlock(name).finally(() => {
              setBusy(false);
              setSaving(null);
            });
          }}
        >
          <Input
            // The comp opens this input focused (763): the person just asked to name the block.
            autoFocus
            aria-label={t('email:inspector.blockName', 'Block name')}
            placeholder={t('email:inspector.blockName', 'Block name')}
            value={saving.name}
            onChange={(event) => setSaving({ name: event.target.value })}
            className="min-w-0 flex-1 border-accent font-bold"
            data-testid="email-save-block-name"
          />
          <Button type="submit" size="md" loading={busy} data-testid="email-save-block-confirm">
            {t('email:inspector.save', 'Save')}
          </Button>
        </form>
      )}
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" iconLeft={<Copy />} className="flex-1" onClick={onDuplicate} data-testid="email-block-duplicate">
          {t('email:inspector.duplicate', 'Duplicate')}
        </Button>
        <Button variant="outline" size="sm" iconLeft={<Trash2 />} className="flex-1 text-danger" onClick={onRemove} data-testid="email-block-remove">
          {t('email:inspector.remove', 'Remove')}
        </Button>
      </div>
    </div>
  );
}
