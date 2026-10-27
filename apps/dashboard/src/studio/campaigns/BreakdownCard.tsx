// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The send dialog's "Breakdown" (comp `Email To Contacts.dc.html` 84-93,
 * 1311): who gets the campaign and who is left out, each way, from the
 * server's own count (the same arithmetic the run does). Each line is a 22px
 * tone tile, the count in mono (end-aligned, at least 48px, left to right
 * in every language) and the words. The comp draws four lines; the others
 * the server counts (waiting for review, not offered a way to say no,
 * sample rows, test addresses, no address) show only when they are not
 * zero, so the lines always add up.
 */
import { Ban, Check, Hourglass, Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@adminium/ui';

import type { EmailAudienceBreakdown, EmailPurpose } from '../../email/api.js';
import { t } from '../../i18n/t.js';
import { purposeLabel } from './campaignWords.js';

interface Line {
  key: string;
  count: string;
  text: string;
  icon: ReactNode;
  positive: boolean;
}

export function BreakdownCard({ breakdown, purpose, existing }: { breakdown: EmailAudienceBreakdown; purpose: EmailPurpose; existing: boolean }): ReactNode {
  const lines: Line[] = [
    { key: 'consent', count: String(breakdown.consent), text: t('studio:email.send.breakdown.consent', 'may be e-mailed for the {purpose}', { purpose: purposeLabel(purpose) }), icon: <Check />, positive: true },
  ];
  if (existing) lines.push({ key: 'existing', count: `+ ${String(breakdown.existingCustomers)}`, text: t('studio:email.send.breakdown.existing', 'existing customers'), icon: <Plus />, positive: true });
  lines.push({ key: 'dne', count: String(breakdown.doNotEmail), text: t('studio:email.send.breakdown.doNotEmail', 'on the do-not-email list — skipped'), icon: <Ban />, positive: false });
  lines.push({ key: 'not-agreed', count: String(breakdown.notAgreed), text: t('studio:email.send.breakdown.notAgreed', 'haven’t agreed — skipped'), icon: <Minus />, positive: false });
  const more: [keyof EmailAudienceBreakdown, string, ReactNode][] = [
    ['awaitingReview', t('studio:email.send.breakdown.awaitingReview', 'ticked before records were kept — waiting for review'), <Hourglass key="i" />],
    ['notMarked', t('studio:email.send.breakdown.notMarked', 'customers never offered a way to say no — skipped'), <Minus key="i" />],
    ['sample', t('studio:email.send.breakdown.sample', 'sample rows — skipped'), <Minus key="i" />],
    ['reservedDomain', t('studio:email.send.breakdown.reserved', 'test addresses — skipped'), <Minus key="i" />],
    ['noAddress', t('studio:email.send.breakdown.noAddress', 'with no address — skipped'), <Minus key="i" />],
  ];
  for (const [field, text, icon] of more) {
    if (breakdown[field] > 0) lines.push({ key: field, count: String(breakdown[field]), text, icon, positive: false });
  }
  return (
    <div data-testid="email-send-breakdown" className="flex flex-col gap-[9px] rounded-xl border border-border bg-surface-2 px-4 py-3.5">
      <span className="text-micro uppercase text-fg-subtle">{t('studio:email.send.breakdown.title', 'Breakdown')}</span>
      {lines.map((line) => (
        <div key={line.key} data-testid={`email-send-breakdown-${line.key}`} className="flex items-center gap-2.5 text-body">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-[22px] shrink-0 items-center justify-center rounded-[6px] [&_svg]:size-3',
              line.positive ? 'bg-pos-soft text-pos' : 'bg-surface-3 text-fg-muted',
            )}
          >
            {line.icon}
          </span>
          <span dir="ltr" className="min-w-12 text-end font-mono font-bold text-fg">
            {line.count}
          </span>
          <span className={line.positive ? 'text-fg' : 'text-fg-muted'}>{line.text}</span>
        </div>
      ))}
    </div>
  );
}
