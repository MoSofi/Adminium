// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What sits under the editor's header for a campaign that has been sent
 * (comp `Email To Contacts.dc.html` 380, 407, 466-469):
 *
 *  - while its run sends or is paused, the info strip "Changes you make now
 *    apply to the next send, not this one." (the run sends the content frozen
 *    at its start);
 *  - when its last run was stopped by a refusal at a batch (the sender's
 *    checks, or the sender lost the right to the table), a danger strip that
 *    says why, with the sender refusal's fix link;
 *  - the two tabs: the editor ("Edit"; the comp's "Design" is already the
 *    inspector's tab name, so this one is named after today's view) and
 *    "Send log".
 */
import { Link } from '@tanstack/react-router';
import { CircleAlert, Info, List, PenLine } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@adminium/ui';

import type { EmailRunView, EmailSenderRefusal } from '../../email/api.js';
import { docsUrl } from '../../kb/docsLinks.js';
import { t } from '../../i18n/t.js';
import { StudioWords, refusalFix, senderRefusalText } from './campaignWords.js';
import { runIsActive } from './RunControls.js';

export type CampaignView = 'edit' | 'log';

const SENDER_REFUSALS: readonly string[] = ['no-postal-address', 'free-mail-from', 'dns-unchecked', 'no-dmarc', 'not-aligned', 'no-public-address'];

export interface CampaignBarProps {
  run: EmailRunView | undefined;
  view: CampaignView;
  onViewChange: (view: CampaignView) => void;
}

export function CampaignBar(props: CampaignBarProps): ReactNode {
  return (
    <StudioWords>
      <Bar {...props} />
    </StudioWords>
  );
}

/** Why a run stopped at a batch, when it did: the code the server kept in its failures. */
function stoppedBy(run: EmailRunView | undefined): string | null {
  if (run === undefined || run.status !== 'failed') return null;
  const first = run.failures[0];
  return first !== undefined && first.to === '' && first.error !== '' ? first.error : null;
}

function Bar({ run, view, onViewChange }: CampaignBarProps): ReactNode {
  const active = runIsActive(run) && (run.status === 'running' || run.state === 'paused');
  const stopped = stoppedBy(run);
  const tab = (value: CampaignView, label: string, icon: ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === value}
      data-testid={`email-view-${value}`}
      onClick={() => onViewChange(value)}
      className={cn(
        '-mb-px flex items-center gap-[7px] border-b-2 px-3.5 py-[11px] text-body font-bold [&_svg]:size-[15px]',
        'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
        view === value ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
      )}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <>
      {active ? (
        <div data-testid="email-run-strip" className="flex items-center gap-[9px] border-b border-border bg-info-soft px-[22px] py-[9px] text-body-sm text-fg">
          <Info className="size-[15px] shrink-0 text-info" aria-hidden="true" />
          {t('studio:email.send.run.frozen', 'Changes you make now apply to the next send, not this one.')}
        </div>
      ) : null}
      {stopped === null ? null : <StoppedStrip code={stopped} />}
      {run === undefined ? null : (
        <div role="tablist" aria-label={t('studio:email.log.tabs', 'Campaign')} className="flex gap-1 border-b border-border bg-surface px-[22px]">
          {tab('edit', t('studio:email.log.tabEdit', 'Edit'), <PenLine aria-hidden="true" />)}
          {tab('log', t('studio:email.log.tab', 'Send log'), <List aria-hidden="true" />)}
        </div>
      )}
    </>
  );
}

function StoppedStrip({ code }: { code: string }): ReactNode {
  const sender = SENDER_REFUSALS.includes(code) ? (code as EmailSenderRefusal) : null;
  const fix = sender === null ? null : refusalFix(sender);
  const link = 'whitespace-nowrap font-bold text-accent hover:underline';
  return (
    <div role="alert" data-testid="email-run-stopped" className="flex flex-wrap items-center gap-[9px] border-b border-border bg-danger-soft px-[22px] py-[9px] text-body-sm text-fg">
      <CircleAlert className="size-[15px] shrink-0 text-danger" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {sender === null
          ? t('studio:email.send.run.stoppedOther', 'The last send stopped before it ended: the person who sent it may no longer send to this table.')
          : t('studio:email.send.run.stoppedRefused', 'The last send stopped: {reason}', { reason: senderRefusalText(sender, null) })}
      </span>
      {fix === null ? null : fix.docs === true ? (
        <a href={docsUrl(fix.to)} target="_blank" rel="noreferrer" className={link}>
          {fix.label}
        </a>
      ) : (
        <Link to={fix.to} {...(fix.hash === undefined ? {} : { hash: fix.hash })} className={link}>
          {fix.label}
        </Link>
      )}
    </div>
  );
}
