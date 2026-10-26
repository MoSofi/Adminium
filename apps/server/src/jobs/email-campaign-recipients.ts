// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A campaign run's recipients, written down before the first message goes.
 *
 * The writer takes the recipients as an async iterator, so an audience that
 * reads a large table page by page streams through it without holding the
 * whole table; the workspace-users audience is the first to feed it. It
 * writes in the order it is given (`seq`), drops an empty address, and keeps
 * the first of two rows with the same address (any case): one person, one
 * message, however often the audience names them.
 *
 * The iterator must not read the meta store inside a transaction the writer
 * holds: it holds none. A start that dies half-way is cleared and written
 * again from the beginning by the next try (`email-campaign-run.ts`), which
 * is safe because nothing is handed over before the run is `running`.
 */
import { emailSendsRepo, type EmailAudience, type EmailRun, type EmailSendInput, type MetaDb } from '@adminium/meta';

import { resolveCampaignAudience } from '../email/audience.js';
import { recipientLocale } from '../i18n/server-i18n.js';

/** Why a workspace user is not mailed: they switched campaign mail off. A code the screen words. */
export const CAMPAIGN_MAIL_OFF = 'campaign-mail-off';

/** Rows the writer gathers before each write. */
const CHUNK = 200;

export interface WrittenRecipients {
  /** Rows written, every state. */
  total: number;
  /** Of them, written as already skipped. */
  skipped: number;
  /** Rows left out because an earlier row had the same address. */
  duplicates: number;
}

/** Writes `recipients` as the ledger rows of `runId`, from the first place on. */
export async function writeRecipients(
  meta: MetaDb,
  runId: string,
  recipients: AsyncIterable<EmailSendInput>,
  at: number,
): Promise<WrittenRecipients> {
  const sends = emailSendsRepo(meta);
  const seen = new Set<string>();
  let chunk: EmailSendInput[] = [];
  let total = 0;
  let skipped = 0;
  let duplicates = 0;
  const flush = async (): Promise<void> => {
    if (chunk.length === 0) return;
    await sends.write(runId, chunk, total, at);
    total += chunk.length;
    chunk = [];
  };
  for await (const recipient of recipients) {
    const address = recipient.address.trim();
    if (address === '') continue;
    const key = address.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    if ((recipient.state ?? 'queued') !== 'queued') skipped += 1;
    chunk.push({ ...recipient, address });
    if (chunk.length >= CHUNK) await flush();
  }
  await flush();
  return { total, skipped, duplicates };
}

/**
 * The workspace-users audience as ledger rows: everyone who gets it, then
 * everyone who switched campaign mail off (written as skipped), each in the
 * language their own settings resolve to.
 */
export async function* usersAudienceRecipients(
  meta: MetaDb,
  audience: Extract<EmailAudience, { kind: 'users' }>,
): AsyncGenerator<EmailSendInput> {
  const resolved = await resolveCampaignAudience(meta, audience);
  for (const user of resolved.recipients) {
    yield { address: user.email, name: user.name, language: await recipientLocale(meta, user.id), personKey: user.id };
  }
  for (const user of resolved.optedOut) {
    yield {
      address: user.email,
      name: user.name,
      language: await recipientLocale(meta, user.id),
      personKey: user.id,
      state: 'skipped-consent',
      reason: CAMPAIGN_MAIL_OFF,
    };
  }
}

/** A run to the people of a table an app declares (`email/audience-table.ts`). */
export type TableAudience = Extract<EmailAudience, { kind: 'table' }>;

/** What reads an audience that is not the workspace's own: a source table's people, for the run named. */
export interface AudienceSources {
  run: EmailRun;
  table?: ((run: EmailRun, audience: TableAudience) => AsyncIterable<EmailSendInput>) | undefined;
}

/** Nobody: a table audience on a server that cannot read its tables (its batch check then refuses the run). */
async function* nobody(): AsyncGenerator<EmailSendInput> {
  // Nothing to write.
}

/** The recipients of any audience a run can name: where a new audience kind joins. */
export function campaignRecipients(meta: MetaDb, audience: EmailAudience, sources?: AudienceSources): AsyncIterable<EmailSendInput> {
  switch (audience.kind) {
    case 'users':
      return usersAudienceRecipients(meta, audience);
    case 'table':
      return sources?.table === undefined ? nobody() : sources.table(sources.run, audience);
  }
}
