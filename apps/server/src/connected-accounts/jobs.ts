// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The engine's one tick and one job kind for connected accounts (cT17).
 *
 * Nothing here is registered per add-on: the runtime is rebuilt on every
 * install, update and switch, and a schedule or job kind cannot be registered
 * twice. The tick is registered once at boot and asks the store what is due.
 * A job carries an account's id and nothing else, and its error is the fixed
 * words of {@link AccountTokenError}, so no token reaches `lastError`.
 */
import { z } from 'zod';

import type { JobRegistry } from '../jobs/registry.js';
import type { ConnectedAccounts } from './service.js';

export const CONNECTED_ACCOUNTS_TICK_NAME = 'connected-accounts.tick';
/** Hourly: clearing what expired and finding rows that went away is not urgent. */
export const CONNECTED_ACCOUNTS_TICK_CRON = '17 * * * *';
export const CONNECTED_ACCOUNT_END_JOB = 'connected-accounts.end';
const END_MAX_ATTEMPTS = 5;

const endPayload = z.object({ accountId: z.string().min(1).max(36) }).strict();

export function registerConnectedAccountJobs(registry: JobRegistry, accounts: ConnectedAccounts): void {
  registry.registerJobHandler(
    CONNECTED_ACCOUNT_END_JOB,
    endPayload,
    async (payload) => {
      const ended = await accounts.endBySystem(payload.accountId);
      return ended === null ? { state: 'gone' } : { state: 'ended', removed: ended.removed, incomplete: ended.incomplete, revoked: ended.revoked };
    },
    { internal: true },
  );
}

/** One run of the tick. A job per account to end, so one that hangs at a provider holds up no other. */
export async function runConnectedAccountsTick(
  accounts: ConnectedAccounts,
  enqueue: (input: { kind: string; payload: Record<string, unknown>; dedupeKey: string; maxAttempts: number }) => Promise<unknown>,
): Promise<{ flows: number; links: number; ending: number }> {
  const swept = await accounts.sweep();
  for (const accountId of swept.ending) {
    await enqueue({ kind: CONNECTED_ACCOUNT_END_JOB, payload: { accountId }, dedupeKey: `connected-account-end:${accountId}`, maxAttempts: END_MAX_ATTEMPTS });
  }
  return { flows: swept.flows, links: swept.links, ending: swept.ending.length };
}
