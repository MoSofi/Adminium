// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A campaign run's marketing checks, at each batch: what the send ledger's
 * seams ask (`email-campaign-run.ts`).
 *
 * Only a run marked `marketing` is checked; a run to the workspace's own
 * people (no class) and a service run send as they always did.
 *
 *  - `checkBatch`: before any row is claimed, the sender checks
 *    (`marketing.refusal`): a free-mail From, no DMARC alignment, no postal
 *    address, no public address. A refused run stops for good with the
 *    refusal's code as its reason, before a single message goes, and on every
 *    later batch too (a postal address removed mid-run stops it).
 *  - `checkRow`: just before each row is handed over, the person's standing
 *    (`marketing.verdict`, the one the app outbox uses): on the do-not-email
 *    list → `skipped-stop`, `do-not-email`; no basis → `skipped-consent`,
 *    `not-agreed`. A run on the consent basis needs a yes for its purpose. A
 *    run that also takes existing customers was written by its audience with
 *    only the rows that qualify (the table's switch, the row's mark, the
 *    customer condition), so here a row without a yes still goes unless the
 *    person has since said no for the purpose.
 *  - `carryFor`: what each marketing message carries (the unsubscribe link,
 *    its two headers, the locked footer), with the token naming the ledger
 *    row so the send log can say "Unsubscribed" on it. A row that went on
 *    the existing-customers basis gets the "all marketing mail" line: its
 *    page has the one button.
 *
 * The purpose is the audience's when it names one, else the newsletter.
 */
import { emailRunsRepo, type ConsentPurpose, type EmailRun, type EmailSend, type MetaDb } from '@adminium/meta';

import { withClickLinks } from '../email/click-link.js';
import { mailLinkKeys } from '../email/link-keys.js';
import { DEFAULT_MARKETING_PURPOSE, type MarketingCarry, type MarketingMail, type MarketingVerdict } from '../email/marketing.js';
import { fromOf } from '../email/send.js';
import { UNSUBSCRIBE_PATH } from '../email/unsubscribe-token.js';
import type { CampaignSeams } from './email-campaign-run.js';

/** Why a ledger row was skipped, as the send log's reason code. */
export const CAMPAIGN_SKIP_DO_NOT_EMAIL = 'do-not-email';
export const CAMPAIGN_SKIP_NOT_AGREED = 'not-agreed';

/** The purpose a run is sent for: its audience's, when the audience names one. */
export function runPurpose(run: Pick<EmailRun, 'audience'>): ConsentPurpose {
  const named = (run.audience as { purpose?: unknown }).purpose;
  return named === 'newsletter' || named === 'surveys' ? named : DEFAULT_MARKETING_PURPOSE;
}

export interface CampaignChecksOptions {
  meta: MetaDb;
  marketing: MarketingMail;
  /** `ADMINIUM_SECRET`: what the click link key is kept under (`link-keys.ts`). */
  secret: string;
  /** Whether the run counts clicks (signed links); off unless its own switch says so. */
  trackClicks?: ((run: EmailRun) => boolean) | undefined;
}

/** The three seams the marketing checks fill, each there. */
export type MarketingCampaignSeams = { [K in 'checkRow' | 'checkBatch' | 'carryFor']-?: NonNullable<CampaignSeams[K]> };

/** The marketing checks the ledger's seams run. */
export function campaignMarketingChecks(options: CampaignChecksOptions): MarketingCampaignSeams {
  const { marketing } = options;
  /** The ground each row passed on, kept from its check to its message (the same batch, the same process). */
  const passed = new Map<string, MarketingVerdict>();

  async function verdictOf(row: EmailSend, run: EmailRun): Promise<MarketingVerdict> {
    return marketing.verdict({
      address: row.address,
      person: row.connectionId !== null && row.personTable !== null && row.personKey !== null ? { connectionId: row.connectionId, table: row.personTable, key: row.personKey } : null,
      purpose: runPurpose(run),
      existingCustomer: run.basis === 'existing-customers',
    });
  }

  return {
    async checkBatch(run) {
      if (run.mailClass !== 'marketing') return 'send';
      // The From of the content as it froze (the first batch freezes it before this check).
      const content = await emailRunsRepo(options.meta).content(run.id);
      const from = (await fromOf(options.meta, content?.variants[0]?.brand ?? null)) ?? '';
      const refused = await marketing.refusal(from);
      return refused === null ? 'send' : { refuse: refused };
    },

    async checkRow(row, run) {
      if (run.mailClass !== 'marketing') return 'send';
      const verdict = await verdictOf(row, run);
      if ('skip' in verdict) {
        return verdict.skip === 'do-not-email' ? { skip: 'skipped-stop', reason: CAMPAIGN_SKIP_DO_NOT_EMAIL } : { skip: 'skipped-consent', reason: CAMPAIGN_SKIP_NOT_AGREED };
      }
      passed.set(row.id, verdict);
      return 'send';
    },

    async carryFor(row, run, locale): Promise<(MarketingCarry & { clicks?: (html: string) => string }) | null> {
      if (run.mailClass !== 'marketing') return null;
      const verdict = passed.get(row.id) ?? (await verdictOf(row, run));
      passed.delete(row.id);
      const purpose = 'send' in verdict && verdict.send === 'existing-customers' ? null : runPurpose(run);
      const carry = await marketing.carry({ to: row.address, purpose, locale, send: row.id });
      if (options.trackClicks?.(run) !== true) return carry;
      const origin = new URL(carry.locked.link.href).origin;
      const key = await mailLinkKeys(options.meta, options.secret).click();
      return { ...carry, clicks: (html) => withClickLinks(html, { key, origin, send: row.id, keep: (href) => href.startsWith(`${origin}${UNSUBSCRIBE_PATH}`) }) };
    },
  };
}
