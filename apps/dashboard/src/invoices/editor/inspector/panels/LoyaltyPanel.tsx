// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Loyalty points panel (comp 1015-1021; bindings 1720): balance and
 * earned (mono, `parseInt || 0` as the comp), then the level — "Level" is
 * 34 Appendix D.2's word for the comp's label at 1019 (the field is `loyLevel`).
 * *Remove section* (`loyShow`).
 */
import { t } from '../../../../i18n/t.js';
import { RemoveSectionButton, TextField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

const integer = (value: string) => Number.parseInt(value, 10) || 0;

export function LoyaltyPanel({ draft, edits, onSelect }: PanelProps) {
  const body = draft.body;
  return (
    <div className="flex flex-col gap-[14px]">
      <TextField label={t('invoices:inspector.loyalty.balance', 'Points balance')} value={String(body.loyBalance)} onFocus={edits.beginEdit} onChange={(value) => edits.set('loyBalance', integer(value))} className="font-mono text-[12.5px] font-bold" testId="invoices-loy-balance" />
      <TextField label={t('invoices:inspector.loyalty.earned', 'Points earned')} value={String(body.loyEarned)} onFocus={edits.beginEdit} onChange={(value) => edits.set('loyEarned', integer(value))} className="font-mono text-[12.5px] font-bold" testId="invoices-loy-earned" />
      <TextField label={t('invoices:inspector.loyalty.level', 'Level')} value={body.loyLevel} onFocus={edits.beginEdit} onChange={(value) => edits.set('loyLevel', value)} className="text-[12.5px] font-bold" testId="invoices-loy-level" />
      <RemoveSectionButton flag="loyShow" edits={edits} onSelect={onSelect} />
    </div>
  );
}
