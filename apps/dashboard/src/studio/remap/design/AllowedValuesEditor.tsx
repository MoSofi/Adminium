// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Allowed values editor (D23, plan 50 F3) — the control that made type
 * `enum` reachable.
 *
 * Choosing `enum` in the designer used to stage a column with an empty value
 * list, which `validateSchemaEdit` refuses as `ENUM_ON_NON_ENUM_COLUMN` at
 * Review: an option that could be picked and never applied, with nowhere in the
 * product to type the values it was asking for (B5).
 *
 * ─── Two refusals, both with their reason on screen ────────────────────────
 *
 * An empty list is refused because an enum with no values is not an enum.
 * REMOVING a value from a NATIVE postgres enum type is refused because postgres
 * has no `ALTER TYPE … DROP VALUE` at all — the values of a native type
 * are add-only, and pretending otherwise plans a statement no engine has.
 * Adminium's own enum columns are CHECK-backed and have neither limit.
 */
import { Button, IconButton, Input } from '@adminium/ui';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';

import { t } from '../../../i18n/t.js';

export interface AllowedValuesEditorProps {
  /** Ordered values; the order is the order the form's options render in. */
  values: readonly string[];
  /**
   * True for a NATIVE postgres enum type: values can be added, never removed
   * or renamed, because postgres has no statement for either.
   */
  addOnly?: boolean;
  onChange: (next: string[]) => void;
}

export function AllowedValuesEditor({ values, addOnly = false, onChange }: AllowedValuesEditorProps) {
  const setAt = (index: number, text: string): void =>
    onChange(values.map((value, i) => (i === index ? text : value)));

  const removeAt = (index: number): void => onChange(values.filter((_, i) => i !== index));

  const move = (index: number, by: -1 | 1): void => {
    const to = index + by;
    if (to < 0 || to >= values.length) return;
    const next = [...values];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  };

  const duplicate = (value: string, index: number): boolean =>
    value !== '' && values.findIndex((other) => other === value) !== index;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-caption text-fg-muted">
        {t('studio:design.values.label', 'Allowed values')}
      </p>
      {values.length === 0 ? (
        <p className="text-caption text-danger">
          {t(
            'studio:design.values.empty',
            'A choice column needs at least one value before this change can be reviewed.',
          )}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {values.map((value, index) => (
          <li key={index} className="flex items-center gap-1">
            <Input
              className="w-40"
              value={value}
              aria-label={t('studio:design.values.value', 'Value {n}', { n: index + 1 })}
              placeholder={t('studio:design.values.placeholder', 'in_progress')}
              error={value === '' || duplicate(value, index)}
              readOnly={addOnly}
              onChange={(event) => setAt(index, event.target.value)}
            />
            <IconButton
              label={t('studio:design.values.up', 'Move {value} up', { value })}
              size="sm"
              variant="ghost"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={t('studio:design.values.down', 'Move {value} down', { value })}
              size="sm"
              variant="ghost"
              disabled={index === values.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={t('studio:design.values.remove', 'Remove {value}', { value })}
              size="sm"
              variant="ghost"
              disabled={addOnly}
              onClick={() => removeAt(index)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          </li>
        ))}
      </ul>
      {addOnly ? (
        <p className="text-caption text-fg-muted">
          {t(
            'studio:design.values.addOnly',
            'This list is a type in your database, and Postgres cannot remove or rename a value once it exists. You can add more.',
          )}
        </p>
      ) : null}
      <div>
        <Button size="sm" variant="secondary" onClick={() => onChange([...values, ''])}>
          {t('studio:design.values.add', 'Add value')}
        </Button>
      </div>
    </div>
  );
}
