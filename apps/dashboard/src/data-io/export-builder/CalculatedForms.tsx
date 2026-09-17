// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The three Calculated forms (comp 379-415, 1114-1129): add or subtract two
 * columns, a percentage of one column, a rule with a threshold. Operands are
 * base numeric columns and the totals authored here; a block the shipped
 * parser would refuse is never authored (`addColumn` runs `parseCrudDerived`
 * first).
 */
import { useState } from 'react';
import { Select } from '@adminium/ui';

import { copy } from './copy.js';
import { mkArith, mkPercent, mkRule, operandsOf, takenNames, type CalcAuthored, type Draft } from './model.js';

export interface CalculatedFormsProps {
  draft: Draft;
  onAdd: (authored: CalcAuthored) => void;
  onToast: (message: string) => void;
  spent: boolean;
}

const INPUT =
  'rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-[11.5px] text-fg outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]';

export function CalculatedForms({ draft, onAdd, onToast, spent }: CalculatedFormsProps) {
  const operands = operandsOf(draft);
  const taken = takenNames(draft);
  const first = operands[0]?.column.id ?? '';
  const second = operands[1]?.column.id ?? first;
  const [a, setA] = useState('');
  const [op, setOp] = useState<'+' | '−'>('+');
  const [b, setB] = useState('');
  const [pct, setPct] = useState('20');
  const [pctCol, setPctCol] = useState('');
  const [ruleCol, setRuleCol] = useState('');
  const [threshold, setThreshold] = useState('5,000');
  const [then, setThen] = useState('Waived');
  const [otherwise, setOtherwise] = useState('Standard');
  const byId = new Map(operands.map((operand) => [operand.column.id, operand]));
  const pick = (id: string, fallback: string) => byId.get(id === '' ? fallback : id);
  const addClass = operands.length > 0 && !spent ? 'bg-accent text-accent-fg' : 'cursor-not-allowed bg-surface-3 text-fg-subtle';

  function guard(): boolean {
    if (spent) {
      onToast(copy.limit());
      return false;
    }
    return true;
  }

  return (
    <div className="flex flex-col gap-2.5 px-4 pb-2 pt-1" data-testid="export-builder-calc">
      <Card title={copy.calcArith()}>
        <OperandSelect label={copy.calcFirst()} value={a === '' ? first : a} onChange={setA} operands={operands} testId="export-builder-calc-a" />
        <Select aria-label={copy.calcOp()} value={op} onChange={(event) => setOp(event.currentTarget.value as '+' | '−')} className="max-w-[54px]">
          <option value="+">+</option>
          <option value="−">−</option>
        </Select>
        <OperandSelect label={copy.calcSecond()} value={b === '' ? second : b} onChange={setB} operands={operands} testId="export-builder-calc-b" />
        <AddButton
          className={addClass}
          testId="export-builder-calc-add-arith"
          onClick={() => {
            const left = pick(a, first);
            const right = pick(b, second);
            if (left === undefined || right === undefined) {
              onToast(copy.calcNeedTwo());
              return;
            }
            if (guard()) onAdd(mkArith(left, op, right, taken));
          }}
        />
      </Card>
      <Card title={copy.calcPct()}>
        <input value={pct} onChange={(event) => setPct(event.currentTarget.value)} aria-label={copy.calcPctLabel()} className={`${INPUT} w-[62px] font-mono`} data-testid="export-builder-calc-pct" />
        <span className="text-[12px] font-bold text-fg-muted">{copy.calcPctOf()}</span>
        <OperandSelect label={copy.calcColumn()} value={pctCol === '' ? first : pctCol} onChange={setPctCol} operands={operands} testId="export-builder-calc-pct-col" />
        <AddButton
          className={addClass}
          testId="export-builder-calc-add-pct"
          onClick={() => {
            const target = pick(pctCol, first);
            if (target === undefined) {
              onToast(copy.calcNeedOne());
              return;
            }
            const built = mkPercent(pct, target, taken);
            if (built === null) {
              onToast(copy.calcNeedOne());
              return;
            }
            if (guard()) onAdd(built);
          }}
        />
      </Card>
      <Card title={copy.calcRule()}>
        <span className="text-[12px] font-bold text-fg-muted">{copy.calcIf()}</span>
        <OperandSelect label={copy.calcColumn()} value={ruleCol === '' ? first : ruleCol} onChange={setRuleCol} operands={operands} testId="export-builder-calc-rule-col" />
        <span className="text-[12px] font-bold text-fg-muted">{copy.calcIsOver()}</span>
        <input value={threshold} onChange={(event) => setThreshold(event.currentTarget.value)} aria-label={copy.calcThreshold()} className={`${INPUT} w-[62px] font-mono`} data-testid="export-builder-calc-threshold" />
        <span className="text-[12px] font-bold text-fg-muted">{copy.calcThen()}</span>
        <input value={then} onChange={(event) => setThen(event.currentTarget.value)} aria-label={copy.calcWhenOver()} className={`${INPUT} w-[82px] font-bold`} data-testid="export-builder-calc-then" />
        <span className="text-[12px] font-bold text-fg-muted">{copy.calcElse()}</span>
        <input value={otherwise} onChange={(event) => setOtherwise(event.currentTarget.value)} aria-label={copy.calcOtherwise()} className={`${INPUT} w-[82px] font-bold`} data-testid="export-builder-calc-else" />
        <AddButton
          className={addClass}
          testId="export-builder-calc-add-rule"
          onClick={() => {
            const target = pick(ruleCol, first);
            if (target === undefined) {
              onToast(copy.calcNeedOne());
              return;
            }
            const built = mkRule(target, threshold, then, otherwise, taken);
            if (built === null) {
              onToast(copy.calcNeedOne());
              return;
            }
            if (guard()) onAdd(built);
          }}
        />
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 px-3 py-[11px]">
      <div className="text-[11.5px] font-extrabold text-fg">{title}</div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function OperandSelect({
  label,
  value,
  onChange,
  operands,
  testId,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  operands: ReturnType<typeof operandsOf>;
  testId: string;
}) {
  return (
    <Select aria-label={label} value={value} onChange={(event) => onChange(event.currentTarget.value)} className="max-w-[150px]" data-testid={testId}>
      {operands.map((operand) => (
        <option key={operand.column.id} value={operand.column.id}>
          {operand.column.header}
        </option>
      ))}
    </Select>
  );
}

function AddButton({ className, onClick, testId }: { className: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} className={`nb-ib rounded-[9px] px-3 py-1.5 text-[11.5px] font-extrabold ${className}`} data-testid={testId}>
      {copy.add()}
    </button>
  );
}
