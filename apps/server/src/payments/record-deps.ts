// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the record job is given, kept in a file of its own so the refund code
 * can take a part of it without importing the job.
 */
import type { MetaDb, PaymentAttempt } from '@adminium/meta';
import type { FastifyInstance } from 'fastify';

import type { RecordWriteService } from '../crud/write-service.js';
import type { PayableSources } from './payables.js';

export interface RecordDeps {
  meta: MetaDb;
  sources: PayableSources;
  writes?: RecordWriteService;
  /** For the audit row and the automations a written payment sets off. */
  app?: FastifyInstance;
  now?: () => number;
  log?: { warn: (fields: Record<string, unknown>, message: string) => void };
  /**
   * Called once per payment, by the one run that moved the attempt to
   * `recorded` (the receipt email). A throw is logged, never raised.
   */
  onRecorded?: (attempt: PaymentAttempt) => Promise<unknown>;
  /** Crash injection for tests: called between the steps named. */
  faults?: { afterClaim?: () => Promise<void> | void; afterWrite?: () => Promise<void> | void };
}
