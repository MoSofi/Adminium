// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Branding panel (comp 774-780; `logoIconList` 1580; 34 Appendix E §I4):
 * brand name, the twelve-mark grid, the logo upload with its Remove, the
 * note that an upload replaces the mark, and the pointer to the title
 * section for the accent colour.
 */
import { Palette, Upload } from 'lucide-react';
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { invoiceIcon } from '../../../icons.js';
import { LOGO_MARKS } from '../../../model/envelope.js';
import { DASHED, FOCUS, FileLabel, Hint, Note, PanelLabel, TextField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';
import { uploadFromInput } from '../upload.js';

export function BrandingPanel({ draft, edits, onImageRejected }: PanelProps) {
  const body = draft.body;
  return (
    <div className="flex flex-col gap-4">
      <TextField label={t('invoices:inspector.branding.brandName', 'Brand name')} value={body.logoText} onFocus={edits.beginEdit} onChange={(value) => edits.set('logoText', value)} className="font-bold" testId="invoices-brand-name" />
      <div>
        <PanelLabel id="invoices-logo-mark-label" className="mb-2">
          {t('invoices:inspector.branding.logoMark', 'Logo mark')}
        </PanelLabel>
        <div className="grid grid-cols-6 gap-[6px]" role="group" aria-labelledby="invoices-logo-mark-label">
          {LOGO_MARKS.map((name) => {
            const Mark = invoiceIcon(name);
            const on = body.logoIcon === name;
            return (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={on}
                data-testid="invoices-option"
                data-value={name}
                onClick={() => edits.histSet('logoIcon', name)}
                className={cn(
                  'flex h-9 items-center justify-center rounded-[9px] border transition-colors',
                  FOCUS,
                  on ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface-2 text-fg-muted hover:border-border-strong',
                )}
              >
                <Mark className="size-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <PanelLabel className="mb-2">{t('invoices:inspector.branding.logoImage', 'Logo image')}</PanelLabel>
        <div className="flex gap-[6px]">
          <FileLabel
            onFile={(event) => uploadFromInput(event, (dataUrl) => edits.setImage('logoImage', dataUrl), onImageRejected)}
            className={cn(DASHED, 'flex-1 gap-[7px] rounded-[10px] bg-surface-2 p-[9px]')}
            testId="invoices-logo-upload"
          >
            <Upload className="size-3.5" aria-hidden="true" />
            {t('invoices:inspector.branding.uploadLogo', 'Upload logo')}
          </FileLabel>
          {body.logoImage === '' ? null : (
            <button
              type="button"
              data-testid="invoices-logo-remove"
              onClick={() => edits.setImage('logoImage', '')}
              className={cn('rounded-[10px] border border-border bg-surface px-[11px] py-[9px] text-[11.5px] font-bold text-danger transition-colors hover:border-border-strong', FOCUS)}
            >
              {t('invoices:inspector.branding.removeLogo', 'Remove')}
            </button>
          )}
        </div>
        <Note className="mt-[7px]">
          {t('invoices:inspector.branding.logoNoteBefore', 'An uploaded logo replaces the mark above. All fixed images live under')} <b>{t('invoices:inspector.branding.logoNoteBold', 'Images')}</b>{' '}
          {t('invoices:inspector.branding.logoNoteAfter', 'in the toolbar.')}
        </Note>
      </div>
      <Hint icon={Palette}>
        {t('invoices:inspector.branding.accentHintBefore', 'Change the accent colour under the')} <b>{t('invoices:inspector.branding.accentHintBold', 'title')}</b>{' '}
        {t('invoices:inspector.branding.accentHintAfter', 'section.')}
      </Hint>
    </div>
  );
}
