// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dialog's own words (D27), overridden.
 *
 * Every one of them is GENERATED from what is true about the form — "New
 * customer", "Create customer", the subtitle from the sections, the footnote
 * only when a field carries the mark. These fields override one at a time, and
 * an emptied one goes back to the generated word rather than storing a blank.
 */
import { FormField, Input, Select } from '@adminium/ui';
import type { CrudFormConfig } from '@adminium/engine/config';

import { t } from '../../../i18n/t.js';

type Dialog = NonNullable<CrudFormConfig['dialog']>;

export function DialogSettings({
  dialog,
  onPatch,
}: {
  dialog: Dialog | undefined;
  onPatch: (patch: Partial<Dialog>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="form-dialog-settings">
      <FormField
        label={t('studio:pages.form.dialog.title', 'Title')}
        helper={t('studio:pages.form.dialog.titleHelp', 'Empty uses the generated words.')}
      >
        <Input
          value={dialog?.title ?? ''}
          onChange={(event) => onPatch({ title: event.target.value })}
          data-testid="form-dialog-title"
        />
      </FormField>
      <FormField label={t('studio:pages.form.dialog.subtitle', 'Subtitle')}>
        <Input
          value={dialog?.subtitle ?? ''}
          onChange={(event) => onPatch({ subtitle: event.target.value })}
        />
      </FormField>
      <FormField label={t('studio:pages.form.dialog.cta', 'Button')}>
        <Input
          value={dialog?.cta?.label ?? ''}
          onChange={(event) => onPatch({ cta: { ...(dialog?.cta ?? {}), label: event.target.value } })}
          data-testid="form-dialog-cta"
        />
      </FormField>
      <FormField label={t('studio:pages.form.dialog.ctaIcon', 'Button icon')}>
        <Select
          value={dialog?.cta?.icon ?? ''}
          onChange={(event) =>
            onPatch({
              cta: {
                ...(dialog?.cta ?? {}),
                icon: event.target.value === '' ? undefined : (event.target.value as 'plus'),
              },
            })
          }
        >
          <option value="">{t('studio:pages.form.dialog.iconDefault', 'Default')}</option>
          <option value="plus">plus</option>
          <option value="check">check</option>
          <option value="send">send</option>
          <option value="arrow-right">arrow-right</option>
        </Select>
      </FormField>
    </div>
  );
}
