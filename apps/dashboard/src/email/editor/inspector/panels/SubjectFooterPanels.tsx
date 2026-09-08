// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Subject and Footer panels (comp 650-664, Appendix A §E3): subject
 * line, preheader and the variable chips; the footer textarea with the
 * comp's hint.
 */
import { FormField, Input, Textarea } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { VariablesBox } from '../VariablesBox.js';

export interface SubjectPanelProps {
  subject: string;
  preheader: string;
  vars: readonly string[];
  onSubjectFocus: () => void;
  onSubjectChange: (value: string) => void;
  onPreheaderFocus: () => void;
  onPreheaderChange: (value: string) => void;
  onInsertVar: (token: string) => void;
}

export function SubjectPanel({ subject, preheader, vars, onSubjectFocus, onSubjectChange, onPreheaderFocus, onPreheaderChange, onInsertVar }: SubjectPanelProps) {
  return (
    <div data-testid="email-subject-panel" className="flex flex-col gap-[15px]">
      <FormField label={t('email:inspector.subjectLine', 'Subject line')}>
        <Input data-testid="email-panel-subject" value={subject} onFocus={onSubjectFocus} onChange={(event) => onSubjectChange(event.target.value)} className="font-semibold" />
      </FormField>
      <FormField label={t('email:inspector.preheader', 'Preheader / preview text')}>
        <Input data-testid="email-panel-preheader" value={preheader} onFocus={onPreheaderFocus} onChange={(event) => onPreheaderChange(event.target.value)} />
      </FormField>
      <VariablesBox vars={vars} onInsert={onInsertVar} />
    </div>
  );
}

export interface FooterPanelProps {
  footer: string;
  onFocus: () => void;
  onChange: (value: string) => void;
}

export function FooterPanel({ footer, onFocus, onChange }: FooterPanelProps) {
  return (
    <div data-testid="email-footer-panel" className="flex flex-col gap-[9px]">
      <FormField label={t('email:inspector.footerText', 'Footer text')} helper={t('email:inspector.footerHint', 'Legal text, address & unsubscribe. Shown at the bottom of every send.')}>
        <Textarea rows={6} data-testid="email-panel-footer" value={footer} onFocus={onFocus} onChange={(event) => onChange(event.target.value)} className="text-[12px] leading-[1.6]" />
      </FormField>
    </div>
  );
}
