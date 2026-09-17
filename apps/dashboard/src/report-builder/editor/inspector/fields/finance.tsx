// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The seven money-shaped field groups (comp 399-411, 419-421): late fees,
 * multi-currency, recurring, discount codes, tax lines, payment history,
 * loyalty and the delivery steps.
 *
 * TWO APPENDIX D REPLACEMENTS LIVE HERE. The late-fee suffix reads *% per
 * month* and the loyalty field is *Level*; the comp's own words for both are
 * ones the sweep catches, so Appendix D names them and this file does not
 * repeat them (34 DEP-3/DEP-4). Both are renamed at the SOURCE — the stored
 * field is `loyLevel` — so the built-bytes sweep finds nothing.
 */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import type { RecurFrequency } from '../../../model/envelope.js';
import { rowSeeds } from '../../blockText.js';
import { RowsEditor } from '../RowsEditor.js';
import { FIELD, OptionButton, PanelLabel, SuffixField, TextField } from '../parts.js';
import { rowFieldLabel } from './rowFieldLabel.js';
import type { FieldsProps } from './types.js';

/** 399: *Late fee rate* with the *% per month* suffix, and *Grace period* in days. */
export function LateFeesFields({ block, edits }: FieldsProps<'latefees'>) {
  return (
    <div className="flex flex-col gap-4">
      <SuffixField
        label={t('reportBuilder:inspector.lateRate', 'Late fee rate')}
        // Appendix D row 4: the comp's own suffix is a word.
        suffix={t('reportBuilder:inspector.lateRateUnit', '% per month')}
        value={block.lateRate}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { lateRate: value })}
        testId="report-field-lateRate"
      />
      <SuffixField
        label={t('reportBuilder:inspector.gracePeriod', 'Grace period')}
        suffix={t('reportBuilder:inspector.gracePeriodUnit', 'days')}
        value={String(block.lateDays)}
        onFocus={edits.beginEdit}
        // The comp's `parseInt(e.target.value) || 0` (654).
        onChange={(value) => edits.patchBlock(block.id, { lateDays: Number.parseInt(value, 10) || 0 })}
        testId="report-field-lateDays"
      />
    </div>
  );
}

/** 403: *Base amount* (mono), then code (52) · symbol (36) · rate · remove; *Add currency*. */
export function MultiCurrencyFields({ block, edits }: FieldsProps<'multicurrency'>) {
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label={t('reportBuilder:inspector.baseAmount', 'Base amount')}
        value={block.mcAmount}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { mcAmount: value })}
        className="font-mono text-[13px] font-bold"
        testId="report-field-mcAmount"
      />
      <div className="flex flex-col gap-2">
        <PanelLabel className="mb-0">{t('reportBuilder:inspector.currencies', 'Currencies & rates')}</PanelLabel>
        <RowsEditor
          rows={block.fx}
          addLabel={t('reportBuilder:inspector.addCurrency', 'Add currency')}
          removeLabel={(index) => t('reportBuilder:inspector.remove', 'Remove {noun} {n}', { noun: t('reportBuilder:inspector.currencies', 'Currencies & rates'), n: index + 1 })}
          onAdd={() => edits.addArrayItem(block.id, 'fx', rowSeeds.fx())}
          onRemove={(index) => edits.removeArrayItem(block.id, 'fx', index)}
          removeClassName="h-8"
          renderRow={(row, index, remove) => (
            <div key={index} data-testid="report-fx-row" className="flex items-center gap-1.5">
              <input
                type="text"
                aria-label={t('reportBuilder:inspector.fxCode', 'Currency code {n}', { n: index + 1 })}
                value={row.code}
                onFocus={edits.beginEdit}
                onChange={(event) => edits.updateArrayItem(block.id, 'fx', index, { code: event.target.value })}
                className={cn(FIELD, 'w-[52px] shrink-0 px-2 py-[7px] text-[12.5px] font-bold')}
              />
              <input
                type="text"
                aria-label={t('reportBuilder:inspector.fxSymbol', 'Currency symbol {n}', { n: index + 1 })}
                value={row.sym}
                onFocus={edits.beginEdit}
                onChange={(event) => edits.updateArrayItem(block.id, 'fx', index, { sym: event.target.value })}
                className={cn(FIELD, 'w-9 shrink-0 px-2 py-[7px] text-[12.5px]')}
              />
              <input
                type="text"
                inputMode="decimal"
                aria-label={t('reportBuilder:inspector.fxRate', 'Rate {n}', { n: index + 1 })}
                value={row.rate}
                onFocus={edits.beginEdit}
                onChange={(event) => edits.updateArrayItem(block.id, 'fx', index, { rate: event.target.value })}
                className={cn(FIELD, 'min-w-0 flex-1 px-2 py-[7px] font-mono text-[12.5px]')}
              />
              {remove}
            </div>
          )}
        />
      </div>
    </div>
  );
}

const FREQUENCIES: readonly RecurFrequency[] = ['Weekly', 'Monthly', 'Quarterly', 'Annually'];

/** 405: four frequency options, *Next date*, *Schedule note*. */
export function RecurringFields({ block, edits }: FieldsProps<'recurring'>) {
  const label = (freq: RecurFrequency): string => {
    switch (freq) {
      case 'Weekly':
        return t('reportBuilder:block.recurring.freq.weekly', 'Weekly');
      case 'Monthly':
        return t('reportBuilder:block.recurring.freq.monthly', 'Monthly');
      case 'Quarterly':
        return t('reportBuilder:block.recurring.freq.quarterly', 'Quarterly');
      case 'Annually':
        return t('reportBuilder:block.recurring.freq.annually', 'Annually');
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div>
        <PanelLabel className="mb-2">{t('reportBuilder:inspector.frequency', 'Frequency')}</PanelLabel>
        <div className="flex flex-wrap gap-1.5">
          {FREQUENCIES.map((freq) => (
            <OptionButton
              key={freq}
              on={block.recurFreq === freq}
              value={freq}
              label={label(freq)}
              testId="report-frequency-option"
              onClick={() => edits.histPatchBlock(block.id, { recurFreq: freq })}
            />
          ))}
        </div>
      </div>
      <TextField
        label={t('reportBuilder:inspector.nextDate', 'Next date')}
        value={block.recurNext}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { recurNext: value })}
      />
      <TextField
        label={t('reportBuilder:inspector.scheduleNote', 'Schedule note')}
        value={block.recurCount}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { recurCount: value })}
      />
    </div>
  );
}

/** 407: a card per code — CODE (mono) · amount (72) · remove, then the description; *Add code*. */
export function DiscountFields({ block, edits }: FieldsProps<'discount'>) {
  return (
    <div className="flex flex-col gap-2">
      <PanelLabel className="mb-0">{t('reportBuilder:inspector.discountCodes', 'Discount codes')}</PanelLabel>
      <RowsEditor
        rows={block.discCodes}
        addLabel={t('reportBuilder:inspector.addCode', 'Add code')}
        removeLabel={(index) => t('reportBuilder:inspector.remove', 'Remove {noun} {n}', { noun: t('reportBuilder:inspector.code', 'CODE'), n: index + 1 })}
        onAdd={() => edits.addArrayItem(block.id, 'discCodes', rowSeeds.discount())}
        onRemove={(index) => edits.removeArrayItem(block.id, 'discCodes', index)}
        removeClassName="h-8"
        renderRow={(row, index, remove) => (
          <div key={index} data-testid="report-discount-row" className="flex flex-col gap-1.5 rounded-[9px] border border-border bg-surface-2 p-2">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                aria-label={rowFieldLabel(t('reportBuilder:inspector.code', 'CODE'), index)}
                value={row.code}
                onFocus={edits.beginEdit}
                onChange={(event) => edits.updateArrayItem(block.id, 'discCodes', index, { code: event.target.value })}
                className={cn(FIELD, 'min-w-0 flex-1 bg-surface px-2 py-[7px] font-mono text-[12px] font-bold')}
              />
              <input
                type="text"
                aria-label={rowFieldLabel(t('reportBuilder:inspector.amount', 'Amount'), index)}
                value={row.amount}
                onFocus={edits.beginEdit}
                onChange={(event) => edits.updateArrayItem(block.id, 'discCodes', index, { amount: event.target.value })}
                className={cn(FIELD, 'w-[72px] shrink-0 bg-surface px-2 py-[7px] font-mono text-[12px]')}
              />
              {remove}
            </div>
            <input
              type="text"
              aria-label={rowFieldLabel(t('reportBuilder:inspector.description', 'Description'), index)}
              value={row.label}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateArrayItem(block.id, 'discCodes', index, { label: event.target.value })}
              className={cn(FIELD, 'bg-surface px-2 py-[7px] text-[12.5px]')}
            />
          </div>
        )}
      />
    </div>
  );
}

/** 409: label · amount (80 mono) · remove; *Add tax line*. */
export function TaxBreakFields({ block, edits }: FieldsProps<'taxbreak'>) {
  return (
    <div className="flex flex-col gap-2">
      <PanelLabel className="mb-0">{t('reportBuilder:inspector.taxComponents', 'Tax components')}</PanelLabel>
      <RowsEditor
        rows={block.taxLines}
        addLabel={t('reportBuilder:inspector.addTaxLine', 'Add tax line')}
        removeLabel={(index) => t('reportBuilder:inspector.remove', 'Remove {noun} {n}', { noun: t('reportBuilder:inspector.taxComponents', 'Tax components'), n: index + 1 })}
        onAdd={() => edits.addArrayItem(block.id, 'taxLines', rowSeeds.taxLine())}
        onRemove={(index) => edits.removeArrayItem(block.id, 'taxLines', index)}
        removeClassName="h-8"
        renderRow={(row, index, remove) => (
          <div key={index} data-testid="report-tax-row" className="flex items-center gap-1.5">
            <TextField
              ariaLabel={t('reportBuilder:inspector.taxLabel', 'Tax label {n}', { n: index + 1 })}
              value={row.label}
              onFocus={edits.beginEdit}
              onChange={(value) => edits.updateArrayItem(block.id, 'taxLines', index, { label: value })}
              className="min-w-0 flex-1 py-[7px] text-[12.5px]"
            />
            <input
              type="text"
              aria-label={rowFieldLabel(t('reportBuilder:inspector.amount', 'Amount'), index)}
              value={row.amount}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateArrayItem(block.id, 'taxLines', index, { amount: event.target.value })}
              className={cn(FIELD, 'w-20 shrink-0 px-2 py-[7px] font-mono text-[12.5px]')}
            />
            {remove}
          </div>
        )}
      />
    </div>
  );
}

/** 411: a card per payment — Date · Amount (80 mono) · remove, then Method; *Add payment*. */
export function PayHistoryFields({ block, edits }: FieldsProps<'payhistory'>) {
  return (
    <div className="flex flex-col gap-2">
      <PanelLabel className="mb-0">{t('reportBuilder:inspector.payments', 'Payments')}</PanelLabel>
      <RowsEditor
        rows={block.payHist}
        addLabel={t('reportBuilder:inspector.addPayment', 'Add payment')}
        removeLabel={(index) => t('reportBuilder:inspector.remove', 'Remove {noun} {n}', { noun: t('reportBuilder:inspector.payments', 'Payments'), n: index + 1 })}
        onAdd={() => edits.addArrayItem(block.id, 'payHist', rowSeeds.payment())}
        onRemove={(index) => edits.removeArrayItem(block.id, 'payHist', index)}
        removeClassName="h-8"
        renderRow={(row, index, remove) => (
          <div key={index} data-testid="report-payment-row" className="flex flex-col gap-1.5 rounded-[9px] border border-border bg-surface-2 p-2">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                aria-label={rowFieldLabel(t('reportBuilder:inspector.date', 'Date'), index)}
                value={row.date}
                onFocus={edits.beginEdit}
                onChange={(event) => edits.updateArrayItem(block.id, 'payHist', index, { date: event.target.value })}
                className={cn(FIELD, 'min-w-0 flex-1 bg-surface px-2 py-[7px] text-[12.5px]')}
              />
              <input
                type="text"
                aria-label={rowFieldLabel(t('reportBuilder:inspector.amount', 'Amount'), index)}
                value={row.amount}
                onFocus={edits.beginEdit}
                onChange={(event) => edits.updateArrayItem(block.id, 'payHist', index, { amount: event.target.value })}
                className={cn(FIELD, 'w-20 shrink-0 bg-surface px-2 py-[7px] font-mono text-[12px]')}
              />
              {remove}
            </div>
            <input
              type="text"
              aria-label={rowFieldLabel(t('reportBuilder:inspector.method', 'Method'), index)}
              value={row.method}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateArrayItem(block.id, 'payHist', index, { method: event.target.value })}
              className={cn(FIELD, 'bg-surface px-2 py-[7px] text-[12.5px]')}
            />
          </div>
        )}
      />
    </div>
  );
}

/** 419: *Points balance* · *Points earned* (both mono integers) · *Level*. */
export function LoyaltyFields({ block, edits }: FieldsProps<'loyalty'>) {
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label={t('reportBuilder:inspector.pointsBalance', 'Points balance')}
        value={String(block.loyBalance)}
        onFocus={edits.beginEdit}
        // The comp's `parseInt(e.target.value) || 0` (665).
        onChange={(value) => edits.patchBlock(block.id, { loyBalance: Number.parseInt(value, 10) || 0 })}
        className="font-mono text-[13px] font-bold"
        testId="report-field-loyBalance"
      />
      <TextField
        label={t('reportBuilder:inspector.pointsEarned', 'Points earned')}
        value={String(block.loyEarned)}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { loyEarned: Number.parseInt(value, 10) || 0 })}
        className="font-mono text-[13px] font-bold"
        testId="report-field-loyEarned"
      />
      <TextField
        // Appendix D row 5: the comp's own label and field name are words.
        label={t('reportBuilder:inspector.level', 'Level')}
        value={block.loyLevel}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { loyLevel: value })}
        testId="report-field-loyLevel"
      />
    </div>
  );
}

/** 421: label · a 96 px status button cycling Pending → In progress → Done (667) · remove; *Add step*. */
export function DeliveryFields({ block, edits }: FieldsProps<'delivery'>) {
  const order = ['todo', 'current', 'done'] as const;
  const label = (status: (typeof order)[number]): string => {
    switch (status) {
      case 'done':
        return t('reportBuilder:block.delivery.done', 'Done');
      case 'current':
        return t('reportBuilder:block.delivery.current', 'In progress');
      case 'todo':
        return t('reportBuilder:block.delivery.todo', 'Pending');
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <PanelLabel className="mb-0">{t('reportBuilder:inspector.steps', 'Steps')}</PanelLabel>
      <RowsEditor
        rows={block.delSteps}
        addLabel={t('reportBuilder:inspector.addStep', 'Add step')}
        removeLabel={(index) => t('reportBuilder:inspector.remove', 'Remove {noun} {n}', { noun: t('reportBuilder:inspector.steps', 'Steps'), n: index + 1 })}
        onAdd={() => edits.addArrayItem(block.id, 'delSteps', rowSeeds.step())}
        onRemove={(index) => edits.removeArrayItem(block.id, 'delSteps', index)}
        removeClassName="h-8"
        renderRow={(row, index, remove) => (
          <div key={index} data-testid="report-step-row" className="flex items-center gap-1.5">
            <TextField
              ariaLabel={t('reportBuilder:inspector.stepLabel', 'Step {n}', { n: index + 1 })}
              value={row.label}
              onFocus={edits.beginEdit}
              onChange={(value) => edits.updateArrayItem(block.id, 'delSteps', index, { label: value })}
              className="min-w-0 flex-1 py-[7px] text-[12.5px]"
            />
            <button
              type="button"
              data-testid="report-step-status"
              data-status={row.status}
              onClick={() => edits.updateArrayItem(block.id, 'delSteps', index, { status: order[(order.indexOf(row.status) + 1) % 3] })}
              className="h-8 w-24 shrink-0 rounded-[9px] border border-border bg-surface-2 text-[11.5px] font-bold text-fg-muted transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {label(row.status)}
            </button>
            {remove}
          </div>
        )}
      />
    </div>
  );
}
