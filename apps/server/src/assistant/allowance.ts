// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The daily allowance: how much of the assistant one person may use in a day.
 *
 * COUNTED AS IT IS SPENT. Every provider round adds its tokens to the
 * person's row for the day (`adminium_assistant_use`), in one adding
 * statement, and the next round is not asked for once the day's number is
 * reached. A turn's own row learns its tokens only when it ends, so a sum
 * over turns would never see the turn that is spending.
 *
 * WHERE A PROVIDER REPORTS NO USAGE the size of what was sent and what came
 * back is estimated, the way a turn's size is estimated before it is sent:
 * an allowance that an unmetered model never touches is no allowance.
 *
 * THE DAY IS THE UTC DAY. It turns over for everybody at the same instant,
 * which the dashboard shows in each person's own time.
 */
import { estimateAssistantInputTokens, estimateTokens } from '@adminium/llm';
import { assistantUseDay, assistantUseRepo, assistantUseResetsAt, settingsRepo, type MetaDb } from '@adminium/meta';

export interface AssistantAllowance {
  /** Tokens a person may use in a day; 0 means there is no limit. */
  limit: number;
  used: number;
  /** The instant the day's use starts again from nothing (epoch ms). */
  resetsAt: number;
  /** Whether another round may be asked for. */
  left: boolean;
}

export async function readAllowance(meta: MetaDb, userId: string | null, at: number): Promise<AssistantAllowance> {
  const limit = await settingsRepo(meta).get('assistant.dailyTokens');
  const used = userId === null ? 0 : (await assistantUseRepo(meta).get(userId, assistantUseDay(at))).tokens;
  return { limit, used, resetsAt: assistantUseResetsAt(at), left: limit === 0 || used < limit };
}

/** What one provider round cost: what the provider said, else what its size says. */
export function roundTokens(input: {
  system: string;
  messages: readonly { role: 'user' | 'assistant'; content: string }[];
  reply: string;
  usage?: { inputTokens: number; outputTokens: number } | undefined;
}): number {
  const reported = (input.usage?.inputTokens ?? 0) + (input.usage?.outputTokens ?? 0);
  if (reported > 0) return reported;
  return estimateAssistantInputTokens(input.system, input.messages) + estimateTokens(input.reply);
}

/** Add to a person's day. A turn with no person (a harness) spends nobody's allowance. */
export async function spend(meta: MetaDb, userId: string | null, delta: { tokens?: number; turns?: number }, at: number): Promise<void> {
  if (userId === null) return;
  await assistantUseRepo(meta).add(userId, assistantUseDay(at), delta);
}
