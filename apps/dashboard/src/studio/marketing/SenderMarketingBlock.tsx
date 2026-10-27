// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The "Marketing mail" block under a sender in Workspace settings › Senders
 * (comp `Email To Contacts.dc.html` 5a 694-715, 5b 763-789, 5c 797-809):
 * what a sender needs before marketing mail may go from it.
 *
 *  - Postal address ("Required for marketing mail.") and "Replies to
 *    marketing mail go to": one each per install, so they show in one
 *    sender's block (the first at the business's own domain), as fields of
 *    the page's one form, saved with "Save changes";
 *  - "Sign marketing mail (DKIM)": "Make a key" while the domain has none;
 *    then the DNS record (copy), and "Found in DNS" or "Not found yet — DNS
 *    can take an hour" with "Check again";
 *  - "DMARC": "Found: p=…" or "Not found" with "How to add a DMARC record";
 *  - a sender at a public mailbox shows only "Can't send marketing mail: use
 *    your own domain."
 *
 * DNS is asked per sender, after the block is drawn (`senderCheckQuery`), so
 * the page never waits on it. Ids for the send dialog's fix links:
 * `#marketing-postal-address`, `#marketing-reply-to`.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, CircleX, Clock, Copy, ExternalLink, KeyRound, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge, Button, IconButton, Input, Spinner } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { docsUrl } from '../../kb/docsLinks.js';
import { useAppToasts } from '../../pages/toasts.js';
import { MARKETING_QUERY_KEY, makeDkimKey, senderCheckQuery, type MarketingSender } from './marketingApi.js';

/** The docs page the DMARC link opens. */
export const DMARC_GUIDE = 'guides/email/campaigns/#dmarc';

/** One labelled row: the comp's 200px label column and a control that takes the rest. */
function Row({ label, sub, center, children }: { label: ReactNode; sub?: ReactNode; center?: boolean; children: ReactNode }): ReactNode {
  return (
    <div className={`flex flex-wrap gap-x-4 gap-y-2${center === true ? ' items-center' : ''}`}>
      <div className="flex-[0_0_200px]">
        <div className="text-body-sm font-bold text-fg">{label}</div>
        {sub === undefined ? null : <div className="text-caption text-fg-muted">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

/** The comp's status badge: radius 6, 11.5 / 700. */
function State({ tone, icon, children }: { tone: 'pos' | 'warn' | 'neutral'; icon: ReactNode; children: ReactNode }): ReactNode {
  return (
    <Badge tone={tone} className="whitespace-normal rounded-sm px-2 text-start text-[11.5px] leading-[normal] [&_svg]:size-3 [&_svg]:shrink-0">
      {icon}
      {children}
    </Badge>
  );
}

async function copy(text: string, done: () => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    done();
  } catch {
    // A refused clipboard leaves the text on screen to select by hand.
  }
}

export interface SenderMarketingBlockProps {
  sender: MarketingSender;
  /** The install's postal address and reply address are edited in this block. */
  host: boolean;
  postal?: { value: string; error: string | null; onChange: (value: string) => void } | undefined;
  replyTo?: { value: string; error: string | null; onChange: (value: string) => void } | undefined;
}

export function SenderMarketingBlock({ sender, host, postal, replyTo }: SenderMarketingBlockProps): ReactNode {
  const toasts = useAppToasts();
  const queryClient = useQueryClient();
  const check = useQuery({ ...senderCheckQuery(sender.address), enabled: !sender.freeMail });
  const [making, setMaking] = useState(false);
  const copied = () => toasts.push({ variant: 'success', title: t('studio:marketingMail.copied', 'Copied to the clipboard.') });

  async function makeKey(): Promise<void> {
    if (sender.domain === null) return;
    setMaking(true);
    try {
      await makeDkimKey(sender.domain);
      await queryClient.invalidateQueries({ queryKey: MARKETING_QUERY_KEY });
    } catch {
      toasts.push({ variant: 'error', title: t('studio:marketingMail.dkim.makeFailed', 'The key could not be made. Try again.') });
    } finally {
      setMaking(false);
    }
  }

  function checkAgain(): void {
    toasts.push({ variant: 'info', title: t('studio:marketingMail.dkim.checking', 'Checking {domain} in DNS…', { domain: sender.domain ?? '' }) });
    void check.refetch();
  }

  const installRows = host ? (
    <>
      {postal === undefined ? null : (
        <Row label={t('studio:marketingMail.postal.label', 'Postal address')} sub={t('studio:marketingMail.postal.sub', 'Required for marketing mail.')}>
          <div className="flex flex-[1_1_320px] flex-col gap-1">
            <Input
              id="marketing-postal-address"
              aria-label={t('studio:marketingMail.postal.label', 'Postal address')}
              value={postal.value}
              autoComplete="off"
              error={postal.error !== null}
              onChange={(event) => postal.onChange(event.target.value)}
            />
            {postal.error === null ? null : <p className="text-caption text-danger">{postal.error}</p>}
          </div>
        </Row>
      )}
    </>
  ) : null;

  const replyRow =
    host && replyTo !== undefined ? (
      <Row label={t('studio:marketingMail.replyTo.label', 'Replies to marketing mail go to')}>
        <div className="flex flex-[1_1_320px] flex-col gap-1">
          <Input
            id="marketing-reply-to"
            aria-label={t('studio:marketingMail.replyTo.label', 'Replies to marketing mail go to')}
            dir="ltr"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-[12.5px]"
            value={replyTo.value}
            error={replyTo.error !== null}
            onChange={(event) => replyTo.onChange(event.target.value)}
          />
          {replyTo.error === null ? null : <p className="text-caption text-danger">{replyTo.error}</p>}
        </div>
      </Row>
    ) : null;

  const unchecked = <State tone="warn" icon={<CircleAlert aria-hidden />}>{t('studio:marketingMail.dns.unchecked', 'DNS could not be asked')}</State>;
  const checking = (
    <span className="inline-flex items-center gap-1.5 text-caption text-fg-muted">
      <Spinner size="sm" />
      {t('studio:marketingMail.dns.asking', 'Asking DNS…')}
    </span>
  );
  const checkAgainButton = (
    <Button variant="secondary" size="sm" iconLeft={<RefreshCw />} onClick={checkAgain} loading={check.isFetching} className="h-auto rounded-[10px] px-[11px] py-1.5 font-bold">
      {t('studio:marketingMail.dkim.checkAgain', 'Check again')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4 border-t border-border bg-surface-2 p-4" data-part="marketing-mail" data-sender={sender.address}>
      <span className="text-micro uppercase text-fg-subtle">{t('studio:marketingMail.heading', 'Marketing mail')}</span>
      {sender.freeMail ? (
        <div className="flex items-center gap-2 text-body-sm font-semibold text-danger">
          <CircleX aria-hidden className="size-4 shrink-0" />
          {t('studio:marketingMail.freeMail', 'Can’t send marketing mail: use your own domain.')}
        </div>
      ) : null}
      {installRows}
      {sender.freeMail ? null : (
        <>
          <Row label={t('studio:marketingMail.dkim.label', 'Sign marketing mail (DKIM)')}>
            {sender.key === null || !sender.key.usable ? (
              <div className="flex flex-[1_1_320px] flex-col items-start gap-2">
                {sender.key === null ? null : (
                  <p className="text-caption text-warn">{t('studio:marketingMail.dkim.unusable', 'This key no longer works on this server. Make a new one and publish its record.')}</p>
                )}
                <Button iconLeft={<KeyRound />} loading={making} onClick={() => void makeKey()} className="font-bold">
                  {t('studio:marketingMail.dkim.make', 'Make a key')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-[1_1_320px] flex-col gap-2">
                <div className="flex items-center gap-2.5 rounded-[10px] border border-border-strong bg-surface py-2 pe-2 ps-3">
                  <code dir="ltr" className="min-w-0 flex-1 font-mono text-[12px] [overflow-wrap:anywhere]">
                    {sender.key.record.text}
                  </code>
                  <IconButton variant="bordered" size="md" label={t('studio:marketingMail.dkim.copy', 'Copy DNS record')} onClick={() => void copy(sender.key!.record.text, copied)}>
                    <Copy />
                  </IconButton>
                </div>
                <div className="flex flex-wrap items-center gap-2" data-part="dkim-state">
                  {check.isPending ? (
                    checking
                  ) : check.data?.dkim === 'found' ? (
                    <State tone="pos" icon={<CircleCheck aria-hidden />}>{t('studio:marketingMail.dkim.found', 'Found in DNS')}</State>
                  ) : (
                    <>
                      {check.isError || check.data?.dkim === 'unchecked' ? (
                        unchecked
                      ) : (
                        <State tone="warn" icon={<Clock aria-hidden />}>{t('studio:marketingMail.dkim.notFound', 'Not found yet — DNS can take an hour')}</State>
                      )}
                      {checkAgainButton}
                    </>
                  )}
                </div>
              </div>
            )}
          </Row>
          <Row label={t('studio:marketingMail.dmarc.label', 'DMARC')} center>
            <div className="flex flex-wrap items-center gap-2" data-part="dmarc-state">
              {check.isPending ? (
                checking
              ) : check.isError || check.data?.dmarc === 'unchecked' ? (
                unchecked
              ) : typeof check.data?.dmarc === 'object' && check.data.dmarc !== null && check.data.dmarc.policy !== null ? (
                <State tone="pos" icon={<CircleCheck aria-hidden />}>
                  {t('studio:marketingMail.dmarc.found', 'Found:')}
                  <span dir="ltr" className="font-mono">{`p=${check.data.dmarc.policy}`}</span>
                </State>
              ) : (
                <>
                  <State tone="warn" icon={<CircleAlert aria-hidden />}>{t('studio:marketingMail.dmarc.notFound', 'Not found')}</State>
                  <a href={docsUrl(DMARC_GUIDE)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-body-sm font-bold text-accent hover:underline">
                    {t('studio:marketingMail.dmarc.howTo', 'How to add a DMARC record')}
                    <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                </>
              )}
            </div>
          </Row>
        </>
      )}
      {replyRow}
    </div>
  );
}
