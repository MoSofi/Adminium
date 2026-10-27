// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The locked footer of a marketing e-mail (comp `Email To Contacts.dc.html`
 * 9, 1110-1138; map §7 "Locked footer"): the two lines every marketing mail
 * carries whatever the footer text says (the sender's postal address and the
 * unsubscribe link), each with a lock, in the canvas's footer and in the
 * inspector's footer panel, with "Added to every marketing mail. You can't
 * remove them." Service mail shows none.
 *
 * The link's words are the mail's own (the server writes the same sentence
 * into every copy, from the e-mail words' marketing footer): "Unsubscribe
 * from {business}'s newsletter". A mail on the existing-customers basis reads "… marketing
 * mail" instead; which basis a copy goes on is decided per person at the
 * send, so the editor shows the purpose's wording (CR4, P5a).
 *
 * The postal address and the business's name come from the marketing mail
 * settings; while the address is not set the row says so (a marketing send
 * is refused until it is).
 */
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

import { t } from '../../i18n/t.js';
import { marketingQuery } from '../marketing/marketingApi.js';
import { StudioWords } from './campaignWords.js';

function useLockedLines(): { postal: string; link: string } {
  const settings = useQuery({ ...marketingQuery(), retry: false, staleTime: 60_000 }).data;
  const business = settings?.businessName?.trim() || t('studio:email.send.footer.business', 'your business');
  return {
    postal: settings?.postalAddress ?? t('studio:email.send.footer.noPostal', 'Your postal address (not set yet: marketing mail waits for it)'),
    link: t('studio:email.send.footer.newsletter', 'Unsubscribe from {business}’s newsletter', { business }),
  };
}

/** The two lines drawn in the mail itself, under the footer text. */
export function LockedFooterCanvas(): ReactNode {
  return (
    <StudioWords>
      <CanvasLines />
    </StudioWords>
  );
}

function CanvasLines(): ReactNode {
  const lines = useLockedLines();
  return (
    <div data-testid="email-locked-footer" className="mt-2.5 flex flex-col items-center gap-2 text-center text-[11.5px] leading-[1.5]">
      <div className="flex items-center justify-center gap-1.5 text-[#4a4a54]">
        <Lock className="size-3 shrink-0" aria-hidden="true" />
        <span>{lines.postal}</span>
      </div>
      <div className="flex items-center justify-center gap-1.5">
        <Lock className="size-3 shrink-0 text-[#4a4a54]" aria-hidden="true" />
        <span className="text-[#1c59e0] underline">{lines.link}</span>
      </div>
    </div>
  );
}

/** The inspector's two locked rows and the sentence under them. */
export function LockedFooterRows(): ReactNode {
  return (
    <StudioWords>
      <Rows />
    </StudioWords>
  );
}

function Rows(): ReactNode {
  const lines = useLockedLines();
  const row = 'flex items-start gap-[9px] rounded-[10px] bg-surface-3 px-3 py-2.5 text-body-sm text-fg';
  return (
    <div data-testid="email-locked-rows" className="flex flex-col gap-2">
      <div className={row}>
        <Lock className="mt-0.5 size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
        <span>{lines.postal}</span>
      </div>
      <div className={row}>
        <Lock className="mt-0.5 size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
        <span>{lines.link}</span>
      </div>
      <span className="text-caption text-fg-muted">{t('studio:email.send.footer.locked', 'Added to every marketing mail. You can’t remove them.')}</span>
    </div>
  );
}
