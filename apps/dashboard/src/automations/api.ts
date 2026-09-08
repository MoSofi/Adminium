// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The automations API client (42-automations-and-workflow-logs.md §3.1).
 *
 * TYPE-ONLY MIRROR of `apps/server/src/routes/automations/schema.ts`: the
 * dashboard may not import server runtime code (the dep-cruiser rule
 * `dashboard-no-meta-adapters-llm`), so the reply shapes are restated here by
 * hand and the two files change together. The server file carries the same
 * SYNC NOTE; `automations-routes.test.ts` is what notices a drift, because it
 * asserts the wire from the other side.
 */

import { api } from '../app/api.js';
import type { Graph, Trigger } from './model/graph.js';
import type { RunStatus } from './model/vocabulary.js';

const BASE = '/api/v1/automations';
const RUNS = '/api/v1/automation-runs';

export interface RuleStats {
  runs30d: number;
  /** succeeded ÷ (succeeded + failed); null with no finished runs. */
  successRate30d: number | null;
  lastRunAt: number | null;
}

export interface RuleView {
  id: string;
  connectionId: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger: Trigger;
  graph: Graph;
  timeSavedMinutes: number | null;
  nextRunAt: number | null;
  /** Complete enough to switch on (D12). */
  valid: boolean;
  incompleteNodeId: string | null;
  stats: RuleStats;
  createdAt: number;
  updatedAt: number;
}

export interface CreateRuleInput {
  name: string;
  connectionId: string | null;
  trigger: Trigger;
  graph: Graph;
  enabled: boolean;
  timeSavedMinutes?: number | null;
  description?: string | null;
}

export interface PatchRuleInput {
  name?: string;
  trigger?: Trigger;
  graph?: Graph;
  enabled?: boolean;
  timeSavedMinutes?: number | null;
  description?: string | null;
}

// --- the source catalogue ---------------------------------------------------

export interface SourceColumn {
  name: string;
  label: string;
  logicalType: string;
  isPk: boolean;
  /** Masked or secret — readable by a rule, never writable by one. */
  pii: boolean;
  emailLike: boolean;
  dateLike: boolean;
}

export interface SourceTable {
  id: string;
  label: string;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  /** Which column the poller could watch, per event (D4); null = cannot. */
  watch: { created: string | null; updated: string | null };
  columns: SourceColumn[];
  pageSlug: string | null;
}

export interface SourceConnection {
  id: string;
  name: string;
  dialect: string;
  timezone: string;
  tables: SourceTable[];
}

export interface Sources {
  connections: SourceConnection[];
  templates: { key: string; name: string }[];
  roles: { id: string; name: string }[];
}

// --- stats ------------------------------------------------------------------

export interface RulesStats {
  activeRules: number;
  rulesCreated7d: number;
  runsToday: number;
  runsYesterday: number;
  successToday: number | null;
  successYesterday: number | null;
  timeSavedMinutes30d: number;
  timeSavedMinutesPrev30d: number;
}

// --- runs -------------------------------------------------------------------

export interface RunRow {
  id: string;
  automationId: string;
  ruleName: string;
  status: RunStatus;
  origin: string;
  trigger: string;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  wakeAt: number | null;
}

export interface TraceStep {
  nodeId: string;
  name: string;
  kind: 'trigger' | 'action' | 'condition' | 'branch' | 'wait' | 'stop';
  status: 'ok' | 'fail' | 'run' | 'skip' | 'wait';
  startedAt: number;
  durationMs: number | null;
  log: string | null;
}

export interface Trace {
  version: 1;
  steps: TraceStep[];
  resume: number[] | null;
}

export interface RunView extends RunRow {
  trace: Trace | null;
  triggerEvent: {
    event: string;
    origin: string;
    hops: number;
    record: { connectionId: string; table: string; pk: Record<string, unknown>; label: string } | null;
    snapshot: Record<string, unknown> | null;
    occurredAt: number;
  };
  error: string | null;
}

export interface RunsPage {
  runs: RunRow[];
  cursor: { next: string | null };
  counts: { all: number; success: number; failed: number; running: number };
}

export interface RunsStats {
  runsToday: number;
  successRateToday: number | null;
  failedToday: number;
  avgDurationMsToday: number | null;
}

export type RunFilter = 'success' | 'failed' | 'running';

export interface RunsQuery {
  status?: RunFilter | undefined;
  automationId?: string | undefined;
  cursor?: string | undefined;
}

/** The viewer's own zone — "today" is theirs, not the server's (D22). */
function tz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const encoded = search.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

export const automationsApi = {
  list: (connectionId?: string) =>
    api.get<{ rules: RuleView[] }>(`${BASE}${query({ connectionId })}`),
  detail: (id: string) => api.get<RuleView>(`${BASE}/${id}`),
  create: (input: CreateRuleInput) => api.post<RuleView>(BASE, input),
  patch: (id: string, input: PatchRuleInput) => api.patch<RuleView>(`${BASE}/${id}`, input),
  remove: (id: string) => api.delete<{ deleted: true }>(`${BASE}/${id}`),
  duplicate: (id: string) => api.post<RuleView>(`${BASE}/${id}/duplicate`),
  /** The ON-SCREEN document, not the stored one (D14). */
  test: (id: string, body: { trigger: Trigger; graph: Graph; sampleRecordId?: string }) =>
    api.post<{ trace: Trace; sample: { table: string; pk: Record<string, unknown>; label: string } | null }>(
      `${BASE}/${id}/test`,
      body,
    ),
  sources: () => api.get<Sources>(`${BASE}/sources`),
  stats: () => api.get<RulesStats>(`${BASE}/stats${query({ tz: tz() })}`),

  runs: (params: RunsQuery) => api.get<RunsPage>(`${RUNS}${query({ ...params, tz: tz() })}`),
  run: (id: string) => api.get<{ run: RunView }>(`${RUNS}/${id}`),
  runStats: () => api.get<RunsStats>(`${RUNS}/stats${query({ tz: tz() })}`),
};
