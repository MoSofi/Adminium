// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What every action is handed, and what it hands back (42-automations-and-
 * workflow-logs.md §3.4).
 *
 * Two entry points per action, `run` and `dryRun`, and the split is the whole
 * design of the Test button (D14): a dry run resolves the template, the
 * recipients, the coerced values and the guarded URL — everything the real
 * one does — and stops one line short of the side effect. That is what makes
 * "Test executes nothing" a fact rather than a promise, and it is why the two
 * live in the same file: a dry run that drifted from its real counterpart
 * would pass a test the product then fails.
 */

import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { Dialect } from '@adminium/engine';
import type { Automation, MetaDb, RecordRef } from '@adminium/meta';

import type { ConnectionManager, SourceDatabase } from '../../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import type { EmailTransport, SmtpConfig } from '../../email/types.js';
import type { FileStore } from '../../files/store.js';
import type { NotificationPublisher } from '../../notifications/notify.js';
import type { TokenMap } from '../templating.js';
import type { TraceText } from '../trace.js';

/** The connection half of a run's context; null for a bare schedule tick. */
export interface ActionSource {
  connectionId: string;
  view: SnapshotView;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  /** The trigger or for-each table this run is about. */
  table: ResolvedTable;
  record: RecordRef;
  /** The record, RE-READ at this step and unmasked (§0.3). */
  row: Row;
}

export interface ActionContext {
  meta: MetaDb;
  manager: ConnectionManager;
  /** For `afterRecordWrite`'s fan-out; absent in unit tests of one action. */
  app?: FastifyInstance | undefined;
  rule: Automation;
  runId: string;
  /** Automation hops so far — a write this run makes carries `hops + 1`. */
  hops: number;
  now: number;
  source: ActionSource | null;
  /** `{{record.x}}`, `{{now}}`, `{{ruleName}}`, `{{recordLabel}}` (D16). */
  tokens: TokenMap;
  text: TraceText;
  /** `ADMINIUM_SECRET` — opens the SMTP password and a webhook's header value. */
  secret: string;
  storage?: FileStore | undefined;
  hub?: NotificationPublisher | undefined;
  /** Transport factory; tests inject a recorder instead of a socket. */
  createTransport?: ((config: SmtpConfig) => EmailTransport) | undefined;
  /** Outbound HTTP; tests inject a stub. */
  fetch?: typeof globalThis.fetch | undefined;
}

export interface ActionResult {
  /** The comp's log box, one line. Null when there is nothing to say. */
  log: string | null;
}

/** A step that failed. The message becomes the trace line AND the run's error. */
export class ActionFailure extends Error {
  override readonly name = 'ActionFailure';
}
