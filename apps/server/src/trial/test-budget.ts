// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How often a trial or hosted installation may dial a database to test it.
 *
 * Every connection test opens a session on a database server, and on a trial
 * that server is the operator's, shared with every other trial. The ordinary
 * rate limit counts per person or per address, which a stranger multiplies by
 * signing in from more places; this budget is ONE for the whole installation,
 * whoever asks and from wherever. An ordinary server has none.
 */
import { AppError } from '../errors.js';
import type { TrialPolicy } from './policy.js';

/** Tests one installation may run in {@link CONNECTION_TEST_WINDOW_MS}. */
export const CONNECTION_TESTS_PER_WINDOW = 10;
export const CONNECTION_TEST_WINDOW_MS = 60_000;

/** 429 with the seconds to wait, as the ordinary limiter answers. */
export class ConnectionTestBudgetError extends AppError {
  override readonly name = 'ConnectionTestBudgetError';

  constructor(readonly retryAfterSeconds: number) {
    super(
      429,
      'RATE_LIMITED',
      `This installation has tested ${String(CONNECTION_TESTS_PER_WINDOW)} database connections in the last minute. Wait ${String(retryAfterSeconds)} seconds and try again.`,
      { retryAfterSeconds, limit: CONNECTION_TESTS_PER_WINDOW, scope: 'instance' },
    );
  }
}

export interface ConnectionTestBudget {
  /** Count one test, or throw {@link ConnectionTestBudgetError} when the installation's budget is spent. */
  spend(): void;
}

/** The budget under `policy`: unlimited unless it answers no to `unlimitedConnectionTests`. */
export function connectionTestBudget(policy: Pick<TrialPolicy, 'allows'>, now: () => number = Date.now): ConnectionTestBudget {
  let windowStart = 0;
  let used = 0;
  return {
    spend() {
      if (policy.allows('unlimitedConnectionTests').allowed) return;
      const at = now();
      if (at - windowStart >= CONNECTION_TEST_WINDOW_MS) {
        windowStart = at;
        used = 0;
      }
      if (used >= CONNECTION_TESTS_PER_WINDOW) {
        throw new ConnectionTestBudgetError(Math.max(1, Math.ceil((windowStart + CONNECTION_TEST_WINDOW_MS - at) / 1000)));
      }
      used += 1;
    },
  };
}
