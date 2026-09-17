// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE TRACE — what Workflow Logs draws under "EXECUTION TRACE" (42-
 * automations-and-workflow-logs.md).
 *
 * A run's trace is the only account of what a rule did, and it is read by an
 * admin long after the fact, so two properties matter more than they look:
 *
 * --- It is PII-masked at THIS boundary, and only here --------------------
 *
 * The run itself reads the record unmasked; it has to, to address the email
 * and write the value. What gets STORED — the trigger snapshot, the first
 * step's "record = …" line — goes through `maskRow` first. Masking at the
 * trace boundary rather than at the read means one place to get right, and
 * the place a person actually reads from.
 *
 * --- The step's NAME is captured, not referenced -------------------------
 *
 * A rule can be renamed and rebuilt after a run finishes. A trace that stored
 * node ids and looked their titles up at render time would rewrite history
 * every time somebody edited a step. So each step keeps the title it had when
 * it ran.
 *
 * --- The strings ----------------------------------------------------------
 *
 * Trace lines are written on the SERVER, at the moment the step runs, in the
 * workspace's own language — the way the report-ready notification is. The
 * English below is the inline fallback and is byte-identical to the `en_US`
 * entries of the `automations` namespace; `TraceText` is what the runner
 * hands in once a translator is wired.
 */

import type { AutomationTraceStep, AutomationTrace } from '@adminium/meta';

import type { ResolvedTable } from '../crud/identifiers.js';
import { maskRow, type Row } from '../crud/mask.js';

export type TraceKind = AutomationTraceStep['kind'];
export type TraceStatus = AutomationTraceStep['status'];

/**
 * The trace vocabulary, as functions rather than format strings, so a caller
 * cannot pass the arguments in the wrong order. Every one of these has an
 * `automations:trace.*` key behind it (Appendix A).
 */
export interface TraceText {
  trigger(label: string, summary: string): string;
  scheduleTick(stamp: string): string;
  evaluated(result: boolean): string;
  stopped(): string;
  branch(label: string): string;
  wait(stamp: string): string;
  wouldWait(amount: number, unit: string): string;
  emailOk(smtp: string, to: string): string;
  emailFail(reason: string): string;
  emailWould(subject: string, to: string): string;
  emailNoSmtp(): string;
  emailNoRecipient(column: string): string;
  notifOk(n: number): string;
  createOk(label: string): string;
  updateOk(pairs: string): string;
  writeWould(pairs: string): string;
  hookOk(method: string, path: string, status: number, ms: number): string;
  hookFail(method: string, path: string, status: string): string;
  hookWould(method: string, url: string): string;
  /** The four lines a `document.render` step can write. */
  docOk(number: string): string;
  docSkipped(reason: string): string;
  docWould(kind: string, name: string): string;
  docOff(name: string): string;
  stop(): string;
  undone(): string;
  gone(): string;
  ruleOff(): string;
}

/** The inline fallback — byte-identical to `automations` en_US (Appendix A). */
export const TRACE_EN: TraceText = {
  trigger: (label, summary) => (summary === '' ? `record = ${label}` : `record = ${label} · ${summary}`),
  scheduleTick: (stamp) => `tick · ${stamp}`,
  evaluated: (result) => `evaluated → ${result ? 'true' : 'false'}`,
  stopped: () => 'evaluated → false · stopped',
  branch: (label) => `took “${label}”`,
  wait: (stamp) => `resumes ${stamp}`,
  wouldWait: (amount, unit) => `Would wait ${String(amount)} ${unit}`,
  emailOk: (smtp, to) => `${smtp} · delivered to ${to}`,
  emailFail: (reason) => `ERROR · ${reason}`,
  emailWould: (subject, to) => `Would send “${subject}” to ${to}`,
  emailNoSmtp: () => 'SMTP is not configured — Settings → Email',
  emailNoRecipient: (column) => `No recipient: ${column} is empty`,
  notifOk: (n) => `notified ${String(n)} ${n === 1 ? 'person' : 'people'}`,
  createOk: (label) => `created ${label}`,
  updateOk: (pairs) => `set ${pairs}`,
  writeWould: (pairs) => `Would set ${pairs}`,
  hookOk: (method, path, status, ms) => `${method} ${path} → ${String(status)} · ${String(ms)}ms`,
  hookFail: (method, path, status) => `${method} ${path} → ${status}`,
  docOk: (number) => `document drawn · ${number}`,
  docSkipped: (reason) => `no document drawn · ${reason}`,
  docWould: (kind, name) => `Would draw ${kind} · ${name}`,
  docOff: (name) => `mapping is switched off · ${name}`,
  hookWould: (method, url) => `Would ${method} ${url}`,
  stop: () => 'Stopped here',
  undone: () => 'Undone before it ran',
  gone: () => 'Record no longer exists',
  ruleOff: () => 'Rule was switched off while waiting',
};

/**
 * Accumulates a run's steps. The runner appends as it walks; `snapshot()`
 * hands back what to persist, which happens on every suspend and at the end
 * — a trace half-written when the process dies is still the best account
 * available of what the run had done.
 */
export class TraceBuilder {
  readonly #steps: AutomationTraceStep[] = [];
  #resume: number[] | null = null;

  get steps(): readonly AutomationTraceStep[] {
    return this.#steps;
  }

  /** Milliseconds of actual work — waits contribute nothing (D9, 0028). */
  get workMs(): number {
    return this.#steps.reduce((sum, step) => sum + (step.kind === 'wait' ? 0 : (step.durationMs ?? 0)), 0);
  }

  get failed(): boolean {
    return this.#steps.some((step) => step.status === 'fail');
  }

  append(step: AutomationTraceStep): void {
    this.#steps.push(step);
  }

  add(input: {
    nodeId: string;
    name: string;
    kind: TraceKind;
    status: TraceStatus;
    startedAt: number;
    durationMs?: number | null | undefined;
    log?: string | null | undefined;
  }): void {
    this.#steps.push({
      nodeId: input.nodeId,
      name: input.name.slice(0, 200),
      kind: input.kind,
      status: input.status,
      startedAt: input.startedAt,
      durationMs: input.durationMs ?? null,
      log: input.log === undefined || input.log === null ? null : input.log.slice(0, 2000),
    });
  }

  /** Where a suspended run picks up (D8); null for a run that is finishing. */
  setResume(path: number[] | null): void {
    this.#resume = path;
  }

  snapshot(): AutomationTrace {
    return { version: 1, steps: [...this.#steps], resume: this.#resume };
  }
}

/**
 * The comp's first log line: "record = Jordan Ellis · trial, 2026-09-08"
 * (Automation Rules 144). Two non-PII columns, because the point is to make
 * the row recognisable, not to reproduce it — the record's own page is one
 * click away and is where the values belong.
 */
export function triggerSummary(table: ResolvedTable, row: Row | null): string {
  if (row === null) return '';
  const masked = maskRow(row, table, false);
  const parts: string[] = [];
  for (const [name, column] of table.columns) {
    if (column.isPrimaryKey || column.masked || column.secret) continue;
    const value = masked[name];
    if (value === null || value === undefined || value === '') continue;
    parts.push(String(value).slice(0, 40));
    if (parts.length === 2) break;
  }
  return parts.join(', ');
}

/** `status = no_show, tier = gold` — what a write step reports (Appendix A). */
export function pairsOf(values: Record<string, unknown>): string {
  return Object.entries(values)
    .map(([column, value]) => `${column} = ${value === null ? 'null' : String(value).slice(0, 60)}`)
    .join(', ');
}
