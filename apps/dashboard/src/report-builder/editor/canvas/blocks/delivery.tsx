// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The delivery timeline (comp 339): a hairline rail behind evenly spaced 22 px
 * dots — a done step is a filled accent circle with a check, the current one a
 * 2 px accent ring, a pending one a 2 px border ring — with the label beneath.
 */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import type { DeliveryStepStatus } from '../../../model/envelope.js';
import { reportIcon } from '../../../icons.js';
import { SHEET_SUBTLE } from '../inline.js';
import type { BlockBodyProps } from './types.js';

/** The three step labels (the comp's inspector cycle, 667). */
export function stepLabel(status: DeliveryStepStatus): string {
  switch (status) {
    case 'done':
      return t('reportBuilder:block.delivery.done', 'Done');
    case 'current':
      return t('reportBuilder:block.delivery.current', 'In progress');
    case 'todo':
      return t('reportBuilder:block.delivery.todo', 'Pending');
  }
}

export function DeliveryBlock({ block }: BlockBodyProps<'delivery'>) {
  const CheckGlyph = reportIcon('check');
  return (
    <div data-testid="report-block-delivery" className="relative flex justify-between pt-1">
      <div aria-hidden="true" className="absolute inset-x-[22px] top-[15px] h-0.5 bg-[#ececef]" />
      {block.delSteps.map((step, index) => {
        const done = step.status === 'done';
        const current = step.status === 'current';
        return (
          <div key={index} className="relative z-[1] flex flex-1 flex-col items-center gap-2" data-testid="report-delivery-step" data-status={step.status}>
            <div
              className={cn(
                'flex size-[22px] shrink-0 items-center justify-center rounded-full',
                done
                  ? 'bg-[var(--adm-report-accent)] text-white'
                  : current
                    ? 'border-2 border-[color:var(--adm-report-accent)] bg-white text-[var(--adm-report-accent)]'
                    : cn('border-2 border-[#e2e2e8] bg-white', SHEET_SUBTLE),
              )}
            >
              {done ? <CheckGlyph className="size-3" aria-hidden="true" /> : null}
            </div>
            <span className={cn('text-center text-[10.5px]', done || current ? 'font-bold' : cn('font-semibold', SHEET_SUBTLE))}>{step.label}</span>
            <span className="sr-only">{stepLabel(step.status)}</span>
          </div>
        );
      })}
    </div>
  );
}
