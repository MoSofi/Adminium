// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "A chat's automatic answers stopped for today": the notice a website chat's
 * owner gets when the answerer's daily tokens run out before 18:00 UTC.
 *
 * A budget used up that early is a sign someone is sending many messages, so
 * the owner hears of it while the day is still young: at most once a UTC day
 * per chat, as a form's limit alert is sent (`forms/mail.ts` `alertLimit`),
 * counted on the same marks (`caps.once`), so two refusals at once tell
 * nobody twice. A budget that runs out late in the day says nothing: the day
 * is nearly over, and it opens again at midnight UTC.
 *
 * It goes to the people the chat's `tell` names, else (nobody named, or
 * nobody named still active) to those who may change the chat's settings.
 * Who they are is read only once the alert is due.
 */
import { createHash } from 'node:crypto';

import type { MetaDb } from '@adminium/meta';

import type { EmailLogger } from '../email/send.js';
import { holdersOf, toldBy } from '../forms/mail.js';
import { translatorFor } from '../i18n/server-i18n.js';
import { notify, type NotificationPublisher } from '../notifications/notify.js';
import { DAY_MS } from '../public-api/claim-code.js';

/** The notice's kind: its own row in each person's notification settings. */
export const CHAT_BUDGET_NOTICE = 'chat.budget';

/** The UTC hour from which a used-up budget no longer alerts: the day is nearly over. */
export const CHAT_BUDGET_ALERT_BEFORE_HOUR = 18;

/** Whether a budget used up at `at` is used up early enough to tell anyone. */
export const isEarlyInTheDay = (at: number): boolean => new Date(at).getUTCHours() < CHAT_BUDGET_ALERT_BEFORE_HOUR;

/** At most `limit` marks of a subject and purpose in a window: `FormCaps['once']`. */
export type OnceGate = (subject: string, purpose: string, limit: number, window: number, at: number) => Promise<boolean>;

/** What the alert says about the chat, and whom it tells: read only when it is due. */
export interface ChatBudgetFacts {
  /** The people to tell: {@link chatBudgetPeople}. */
  people: readonly string[];
  /** The chat's name, as its add-on gives it. */
  name: string;
  /** The daily tokens that ran out. */
  dailyTokens: number;
  /** Where the chat's settings open. */
  actionUrl: string;
  /** Whether the e-mail leg may go (no public address or mail server: the bell alone). */
  mail: boolean;
}

export interface ChatBudgetAlertInput {
  meta: MetaDb;
  once: OnceGate;
  hub?: NotificationPublisher | undefined;
  installId: string;
  addOn: string;
  facts: () => Promise<ChatBudgetFacts | null>;
  at: number;
  logger?: EmailLogger | undefined;
}

/**
 * The people a chat's budget alert goes to: those its `tell` names who are
 * still active, else those who hold `settingsUpdate` (the permission that
 * changes the chat's settings row).
 */
export async function chatBudgetPeople(meta: MetaDb, tell: readonly { kind: 'role' | 'person'; id: string }[] | null, settingsUpdate: string): Promise<string[]> {
  const named = tell === null || tell.length === 0 ? [] : await toldBy(meta, tell);
  return named.length > 0 ? named : holdersOf(meta, settingsUpdate);
}

/** The marks' subject for one chat's one UTC day, hashed to a fixed width. */
function subjectOf(installId: string, addOn: string, at: number): string {
  const day = new Date(at).toISOString().slice(0, 10);
  return `chat-budget:${createHash('sha256').update(JSON.stringify([installId, addOn, day])).digest('hex')}`;
}

/** Tells the chat's people its automatic answers stopped for today: once a UTC day, and only before 18:00 UTC. Answers how many were told. */
export async function alertChatBudget(input: ChatBudgetAlertInput): Promise<number> {
  const { meta } = input;
  try {
    if (!isEarlyInTheDay(input.at)) return 0;
    if (!(await input.once(subjectOf(input.installId, input.addOn, input.at), 'alert', 1, DAY_MS, input.at))) return 0;
    const facts = await input.facts();
    if (facts === null) return 0;
    let told = 0;
    for (const userId of facts.people) {
      const i18n = await translatorFor(meta, userId);
      const tag = String(i18n.language || 'en-US').replace('_', '-');
      const tokens = new Intl.NumberFormat(`${tag}-u-nu-latn`).format(facts.dailyTokens);
      await notify(
        meta,
        {
          userId,
          kind: CHAT_BUDGET_NOTICE,
          title: i18n.t('email:chat.budgetTitle', { chat: facts.name, defaultValue: 'Automatic answers in {chat} stopped for today' }),
          body: i18n.t('email:chat.budgetBody', {
            chat: facts.name,
            tokens,
            defaultValue:
              '{chat} used all {tokens} tokens it may spend today before 18:00 UTC, so a person answers every visitor until midnight UTC. Used up this early, it may be someone sending many messages. Look at today’s conversations, or raise the daily tokens in the chat’s settings.',
          }),
          actionUrl: facts.actionUrl,
        },
        { at: input.at, email: facts.mail, ...(input.hub === undefined ? {} : { hub: input.hub }), ...(input.logger === undefined ? {} : { logger: input.logger }) },
      );
      told += 1;
    }
    return told;
  } catch (error) {
    input.logger?.warn({ err: error, addOn: input.addOn }, 'a chat budget alert could not be written');
    return 0;
  }
}
