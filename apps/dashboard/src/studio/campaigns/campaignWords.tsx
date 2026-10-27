// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the campaign screens share: the Studio's words (each screen waits for
 * them itself, so the editor may open one under a `<Suspense>` without
 * loading the namespace for every e-mail it opens), the words for the
 * refusal codes and the send log's states and reasons, and the queries of
 * the send dialog's audience.
 *
 * The screens are the send dialog (`SendCampaignModal`), the run's controls
 * (`RunControls`), the bar under the editor's header (`CampaignBar`), the
 * send log (`SendLog`) and the locked footer (`LockedFooter`); the editor
 * loads each through `lazy.ts`.
 */
import { queryOptions } from '@tanstack/react-query';
import { use, type ReactNode } from 'react';

import { t } from '../../i18n/t.js';
import { emailApi, type EmailAudienceRefusal, type EmailPurpose, type EmailSendLogRow, type EmailSenderRefusal } from '../../email/api.js';
import { studioMessagesReady } from '../studioMessages.js';

/** Renders its children once the Studio's words are in (the nearest `<Suspense>` shows meanwhile). */
export function StudioWords({ children }: { children: ReactNode }): ReactNode {
  use(studioMessagesReady());
  return children;
}

/** Every query of the send dialog's audience: the e-mail sheet refreshes them all on save. */
export const AUDIENCE_KEY = ['email-audience'] as const;

export function audienceTablesQuery() {
  return queryOptions({ queryKey: [...AUDIENCE_KEY, 'tables'] as const, queryFn: () => emailApi.audienceTables(), retry: false });
}

export function peopleTablesQuery() {
  return queryOptions({ queryKey: [...AUDIENCE_KEY, 'people-tables'] as const, queryFn: () => emailApi.peopleTables(), retry: false });
}

export function audienceViewsQuery(connectionId: string, table: string) {
  return queryOptions({ queryKey: [...AUDIENCE_KEY, 'views', connectionId, table] as const, queryFn: () => emailApi.audienceViews(connectionId, table), retry: false });
}

export function reviewListQuery(connectionId: string, table: string) {
  return queryOptions({ queryKey: [...AUDIENCE_KEY, 'review', connectionId, table] as const, queryFn: () => emailApi.reviewList(connectionId, table), retry: false });
}

/** A purpose's name, as "Why you're writing" offers it. */
export function purposeLabel(purpose: EmailPurpose): string {
  return purpose === 'surveys' ? t('studio:email.send.purpose.surveys', 'Surveys') : t('studio:email.send.purpose.newsletter', 'Newsletter');
}

/** Why a table may not be sent to now, naming it (`table` is its label). */
export function audienceRefusalText(reason: EmailAudienceRefusal, table: string): string {
  switch (reason) {
    case 'cannot-read':
      return t('studio:email.send.refused.cannotRead', 'You can no longer read {table}, so you can’t send to it.', { table });
    case 'addresses-masked':
      return t('studio:email.send.refused.masked', 'You see the addresses in {table} masked, so you can’t send to it.', { table });
    case 'addresses-hidden':
      return t('studio:email.send.refused.hidden', 'Your role doesn’t show the addresses in {table}, so you can’t send to it.', { table });
    case 'view-gone':
      return t('studio:email.send.refused.viewGone', 'That view is gone. Pick another.');
    case 'view-search':
      return t('studio:email.send.refused.viewSearch', 'That view has a search in it, so it would mail more people than it shows. Pick another.');
    case 'view-hidden-column':
      return t('studio:email.send.refused.viewHiddenColumn', 'That view filters by a column your role can’t see. Pick another.');
    case 'existing-customers-off':
      return t('studio:email.send.refused.existingOff', 'Existing customers aren’t switched on for {table}.', { table });
    case 'cannot-send':
      return t('studio:email.send.refused.cannotSend', 'You may no longer send campaigns.');
    case 'not-people':
      return t('studio:email.send.refused.notPeople', '{table} can’t be e-mailed from campaigns.', { table });
  }
}

/** Where each sender refusal is put right (the marketing mail settings, by anchor), and the words of the link. */
export const DMARC_GUIDE_PATH = 'guides/email/campaigns/#dmarc';

export interface RefusalFix {
  /** A path in the dashboard, or a docs path when `docs` is true. */
  to: string;
  /** The settings field it lands on. */
  hash?: string;
  docs?: true;
  label: string;
}

export function refusalFix(code: EmailSenderRefusal): RefusalFix {
  switch (code) {
    case 'no-postal-address':
      return { to: '/studio/settings', hash: 'marketing-postal-address', label: t('studio:email.send.fix.addAddress', 'Add address') };
    case 'free-mail-from':
      return { to: '/studio/settings', hash: 'senders', label: t('studio:email.send.fix.changeSender', 'Change sender') };
    case 'dns-unchecked':
      return { to: '/studio/settings', hash: 'senders', label: t('studio:email.send.fix.checkAgain', 'Check again') };
    case 'no-dmarc':
      return { to: DMARC_GUIDE_PATH, docs: true, label: t('studio:email.send.fix.howToAdd', 'How to add one') };
    case 'not-aligned':
      return { to: '/studio/settings', hash: 'senders', label: t('studio:email.send.fix.makeKey', 'Make a key') };
    case 'no-public-address':
      return { to: '/studio/settings', hash: 'email-link-origin', label: t('studio:email.send.fix.setAddress', 'Set the address') };
  }
}

/** The domain of an address, for the sentences that name it. */
export function domainOf(address: string | null | undefined): string {
  if (address === null || address === undefined) return '';
  const at = address.lastIndexOf('@');
  return at < 0 ? '' : address.slice(at + 1);
}

/** What stops a marketing send, in a sentence about the sender `sender`. */
export function senderRefusalText(code: EmailSenderRefusal, sender: string | null | undefined): string {
  // Not known (a run stopped before this screen asked): the sentence names the sender in general.
  const address = sender == null || sender === '' ? t('studio:email.send.refusal.yourSender', 'Your sender') : sender;
  const domain = domainOf(sender) === '' ? t('studio:email.send.refusal.yourDomain', 'Your domain') : domainOf(sender);
  switch (code) {
    case 'no-postal-address':
      return t('studio:email.send.refusal.noPostalAddress', 'Add your postal address to the sender first. The law in many countries asks for it in every marketing mail.');
    case 'free-mail-from':
      return t('studio:email.send.refusal.freeMail', '{address} can’t send marketing mail. Use an address at your own domain.', { address });
    case 'dns-unchecked':
      return t('studio:email.send.refusal.dnsUnchecked', 'DNS couldn’t be asked about {domain}, so its DMARC record couldn’t be checked. Try again in a moment.', { domain });
    case 'no-dmarc':
      return t('studio:email.send.refusal.noDmarc', '{domain} has no DMARC record yet, so marketing mail can’t go out yet.', { domain });
    case 'not-aligned':
      return t('studio:email.send.refusal.notAligned', '{domain} has no signing key (DKIM) of yours in DNS yet, so marketing mail can’t go out yet.', { domain });
    case 'no-public-address':
      return t('studio:email.send.refusal.noPublicAddress', 'This server has no public address, so unsubscribe links would not work.');
  }
}

/** The words of a send-log row's state: its badge and its tone. */
export function sendStateBadge(row: Pick<EmailSendLogRow, 'state' | 'reason' | 'retrying'>, stopped = false): { label: string; tone: 'pos' | 'neutral' | 'warn' | 'danger' | 'info' } {
  switch (row.state) {
    case 'sent':
      // Still being tried after a refusal: the comp's "Failed … will try again".
      return row.retrying ? { label: t('studio:email.log.state.failed', 'Failed'), tone: 'danger' } : { label: t('studio:email.log.state.sent', 'Sent'), tone: 'pos' };
    case 'queued':
    case 'sending':
      // The send was stopped for good: what had not gone never will.
      return stopped ? { label: t('studio:email.log.state.notSent', 'Not sent — the send was stopped'), tone: 'neutral' } : { label: t('studio:email.log.state.waiting', 'Waiting'), tone: 'neutral' };
    case 'skipped-stop':
      return row.reason === 'erased'
        ? { label: t('studio:email.log.state.skippedErased', 'Skipped — erased on request'), tone: 'neutral' }
        : { label: t('studio:email.log.state.skippedList', 'Skipped — do-not-email list'), tone: 'neutral' };
    case 'skipped-consent':
      return { label: skippedLabel(row.reason), tone: 'neutral' };
    case 'bounced':
      return { label: t('studio:email.log.state.bounced', 'Bounced'), tone: 'warn' };
    case 'spam':
      return { label: t('studio:email.log.state.spam', 'Marked as spam'), tone: 'danger' };
    case 'failed':
      return { label: t('studio:email.log.state.failed', 'Failed'), tone: 'danger' };
    case 'unsubscribed':
      return { label: t('studio:email.log.state.unsubscribed', 'Unsubscribed'), tone: 'info' };
  }
}

function skippedLabel(reason: string | null): string {
  switch (reason) {
    case 'awaiting-review':
      return t('studio:email.log.state.skippedReview', 'Skipped — waiting for review');
    case 'not-marked':
      return t('studio:email.log.state.skippedNotMarked', 'Skipped — not offered a way to say no');
    case 'sample':
      return t('studio:email.log.state.skippedSample', 'Skipped — sample row');
    case 'reserved-domain':
      return t('studio:email.log.state.skippedReserved', 'Skipped — test address');
    case 'out-of-reach':
      return t('studio:email.log.state.skippedOutOfReach', 'Skipped — no longer in reach');
    case 'address-changed':
      return t('studio:email.log.state.skippedAddressChanged', 'Skipped — address changed');
    case 'campaign-mail-off':
      return t('studio:email.log.state.skippedMailOff', 'Skipped — turned campaign mail off');
    default:
      return t('studio:email.log.state.skippedNotAgreed', 'Skipped — hasn’t agreed');
  }
}

/** The relays a notice can come from, as the bounce card names them. */
const SERVICE_NAMES: Readonly<Record<string, string>> = { ses: 'Amazon SES', postmark: 'Postmark', mailgun: 'Mailgun', brevo: 'Brevo', sendgrid: 'SendGrid' };

/** A send-log row's detail column: why it was skipped or what went wrong, in words; empty when there is nothing to add. */
export function sendDetail(row: Pick<EmailSendLogRow, 'state' | 'reason' | 'retrying'>): string {
  if (row.state === 'unsubscribed') return t('studio:email.log.detail.afterSending', 'After sending');
  const reason = row.reason ?? '';
  if (reason.startsWith('notice:')) {
    const service = reason.slice('notice:'.length);
    const name = SERVICE_NAMES[service] ?? t('studio:email.log.detail.otherService', 'your mail service');
    return t('studio:email.log.detail.reportedBy', 'Reported by {service}', { service: name });
  }
  if (row.state === 'sent' && row.retrying) return t('studio:email.log.detail.willRetry', '{reason} — will try again', { reason });
  if (row.state === 'bounced' || row.state === 'failed') return reason;
  return '';
}
