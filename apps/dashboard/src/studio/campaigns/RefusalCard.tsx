// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Sender not ready" (comp `Email To Contacts.dc.html` 1c, 267-273): one
 * danger card, one row per refusal a marketing send meets now, each with its
 * own icon, its sentence and the link that puts it right (the marketing mail
 * settings, by anchor, or the DMARC guide). The plan refuses a send without
 * DMARC alignment, so the DMARC row is a blocker like the rest and wears the
 * danger tone too.
 *
 * The address or domain a sentence names is drawn in mono, as the comp draws
 * it: the translated sentence is split around it.
 */
import { Link } from '@tanstack/react-router';
import { ExternalLink, GlobeLock, KeyRound, MailWarning, MapPin, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import type { EmailSenderRefusal } from '../../email/api.js';
import { docsUrl } from '../../kb/docsLinks.js';
import { domainOf, refusalFix, senderRefusalText } from './campaignWords.js';

const ICONS: Record<EmailSenderRefusal, ReactNode> = {
  'no-postal-address': <MapPin aria-hidden="true" />,
  'free-mail-from': <MailWarning aria-hidden="true" />,
  'dns-unchecked': <ShieldAlert aria-hidden="true" />,
  'no-dmarc': <ShieldAlert aria-hidden="true" />,
  'not-aligned': <KeyRound aria-hidden="true" />,
  'no-public-address': <GlobeLock aria-hidden="true" />,
};

/** The sentence with `value` (an address or a domain) drawn in mono wherever it stands. */
export function withMono(sentence: string, value: string): ReactNode {
  if (value === '' || !sentence.includes(value)) return sentence;
  const parts = sentence.split(value);
  return parts.map((part, index) => (
    // The parts of one fixed sentence: their order never changes, so the index is a stable key.
    <span key={index}>
      {part}
      {index < parts.length - 1 ? (
        <span dir="ltr" className="font-mono text-[12px]">
          {value}
        </span>
      ) : null}
    </span>
  ));
}

export function RefusalCard({ refusals, sender }: { refusals: readonly EmailSenderRefusal[]; sender: string | null | undefined }): ReactNode {
  return (
    <div role="alert" data-testid="email-send-refusals" className="shrink-0 overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--danger)_25%,transparent)] bg-surface">
      {refusals.map((code, index) => {
        const fix = refusalFix(code);
        const named = code === 'free-mail-from' ? (sender ?? '') : code === 'dns-unchecked' || code === 'no-dmarc' || code === 'not-aligned' ? domainOf(sender) : '';
        const link = 'inline-flex items-center gap-1 whitespace-nowrap text-body-sm font-bold text-accent hover:underline';
        return (
          <div
            key={code}
            data-testid="email-send-refusal"
            data-code={code}
            className={`flex items-start gap-2.5 px-3.5 py-3 ${index === 0 ? 'bg-danger-soft' : 'border-t border-border'} [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-danger`}
          >
            {ICONS[code]}
            <div className="min-w-0 flex-1 text-body-sm text-fg">{withMono(senderRefusalText(code, sender), named)}</div>
            {fix.docs === true ? (
              <a href={docsUrl(fix.to)} target="_blank" rel="noreferrer" className={link}>
                {fix.label}
                <ExternalLink className="size-3 rtl:-scale-x-100" aria-hidden="true" />
              </a>
            ) : (
              <Link to={fix.to} {...(fix.hash === undefined ? {} : { hash: fix.hash })} className={link}>
                {fix.label}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
