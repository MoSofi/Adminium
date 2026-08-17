// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared fixtures for the direct-path runner tests (not collected — no `.test`).
 *
 * A scripted fake {@link ProviderClient} (injected, never a real network call),
 * small schema snapshots, and a `validate` closure over the real
 * `@adminium/llm` `validateResponse` pipeline — so the tests exercise the true
 * fatal/per-item classification the repair loop reacts to (06-llm-assist.md §7.5).
 */
import { parseDatabaseModel, type DatabaseModel, type StatsResult } from '@adminium/engine';
import {
  ProviderError,
  validateResponse,
  type CompleteRequest,
  type LocaleCode,
  type ProviderClient,
  type ProviderId,
  type ValidationResult,
} from '@adminium/llm';

export const ALLOWED = {
  templates: ['page-crud', 'page-dashboard', 'page-queue-inbox', 'page-board', 'page-directory'],
  widgets: ['kpi-stat-card', 'chart-line-area', 'chart-donut', 'top-movers-list'],
} as const;

/** Single-table `public.orders` snapshot (mirrors the run-service test). */
export const ordersSchema: DatabaseModel = parseDatabaseModel({
  irVersion: 1,
  dialect: 'postgres',
  name: 'shop',
  defaultSchema: 'public',
  tables: [
    {
      schema: 'public',
      name: 'orders',
      columns: [
        { name: 'id', logicalType: 'uuid', isPrimaryKey: true, nullable: false },
        { name: 'order_number', logicalType: 'text', isUnique: true, nullable: false },
        { name: 'status', logicalType: 'text', nullable: false },
      ],
      primaryKey: ['id'],
    },
  ],
});

/** Two disjoint tables — for the chunked map-reduce test. */
export const twoTableSchema: DatabaseModel = parseDatabaseModel({
  irVersion: 1,
  dialect: 'postgres',
  name: 'shop',
  defaultSchema: 'public',
  tables: [
    {
      schema: 'public',
      name: 'orders',
      columns: [
        { name: 'id', logicalType: 'uuid', isPrimaryKey: true, nullable: false },
        { name: 'order_number', logicalType: 'text', isUnique: true, nullable: false },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'customers',
      columns: [
        { name: 'id', logicalType: 'uuid', isPrimaryKey: true, nullable: false },
        { name: 'email', logicalType: 'text', isUnique: true, nullable: false },
      ],
      primaryKey: ['id'],
    },
  ],
});

export const ordersStats: StatsResult[] = [
  {
    table: { schema: 'public', name: 'orders' },
    rowCountEstimate: 41207,
    rowCountExact: false,
    sampled: false,
    columns: [
      { column: 'order_number', nullFraction: 0, distinctCount: 41207 },
      { column: 'status', nullFraction: 0, distinctCount: 5 },
    ],
  },
];

/** A clean, referentially-valid single-locale response for `public.orders`. */
export function validOrdersResponse(runId?: string): string {
  return JSON.stringify({
    schema_version: 'adminium.llm/v1',
    ...(runId !== undefined ? { run_id: runId } : {}),
    tables: [
      {
        table: 'public.orders',
        confidence: 0.9,
        label: { en_US: 'Orders' },
        description: { en_US: 'Customer orders.' },
        icon: 'shopping-cart',
        displayColumn: 'order_number',
        naturalKey: ['order_number'],
        columns: [
          { column: 'order_number', label: { en_US: 'Order number' } },
          { column: 'status', label: { en_US: 'Status' } },
        ],
      },
    ],
  });
}

/** A minimal valid response naming a single arbitrary table (chunked-merge test). */
export function validTableResponse(table: string, displayColumn: string): string {
  return JSON.stringify({
    schema_version: 'adminium.llm/v1',
    tables: [
      {
        table,
        confidence: 0.8,
        label: { en_US: table },
        description: { en_US: `${table} rows.` },
        icon: 'table',
        displayColumn,
        naturalKey: [displayColumn],
        columns: [{ column: displayColumn, label: { en_US: displayColumn } }],
      },
    ],
  });
}

/** Brace-balanced but not JSON → stage-2 `LLM_JSON_PARSE` (fatal, repairable). */
export const MALFORMED_REPLY = '{ this is not json }';

/** Unbalanced object → stage-1 `LLM_TRUNCATED` (fatal, escalates maxTokens). */
export const TRUNCATED_REPLY = '{"schema_version":"adminium.llm/v1","tables":[';

/** Build the run's `validate` closure over the real validation pipeline. */
export function makeValidate(
  snapshot: DatabaseModel,
  runId: string,
  stats?: readonly StatsResult[],
): (rawText: string) => ValidationResult {
  return (rawText) =>
    validateResponse(rawText, {
      snapshot,
      locales: ['en_US'] as LocaleCode[],
      allowedTemplates: ALLOWED.templates,
      allowedWidgets: ALLOWED.widgets,
      ...(stats !== undefined ? { stats } : {}),
      runId,
    });
}

export type ScriptStep =
  | { text: string; usage?: { inputTokens: number; outputTokens: number } }
  | { throw: ProviderError };

export interface ScriptedClient {
  client: ProviderClient;
  /** Every `complete()` request, captured (messages deep-copied). */
  calls: CompleteRequest[];
}

export interface ScriptedClientOptions {
  id?: ProviderId;
  /** Awaited before each reply — lets a test cancel mid-flight. */
  beforeReply?: (callIndex: number) => Promise<void> | void;
}

/**
 * A {@link ProviderClient} that replays `script` (last step repeats if exhausted)
 * and records each `complete()` call. No network, no SDK.
 */
export function makeScriptedClient(
  script: readonly ScriptStep[],
  options: ScriptedClientOptions = {},
): ScriptedClient {
  const calls: CompleteRequest[] = [];
  let index = 0;
  const client: ProviderClient = {
    id: options.id ?? 'anthropic',
    listModels: async () => [{ id: 'm', label: 'm' }],
    test: async () => ({ ok: true, model: 'm', latencyMs: 1 }),
    complete: async (req) => {
      const callIndex = calls.length;
      calls.push({ ...req, messages: req.messages.map((message) => ({ ...message })) });
      await options.beforeReply?.(callIndex);
      const step = script[Math.min(index, script.length - 1)];
      index += 1;
      if (step === undefined) throw new Error('scripted client has no steps');
      if ('throw' in step) throw step.throw;
      return step.usage !== undefined ? { text: step.text, usage: step.usage } : { text: step.text };
    },
  };
  return { client, calls };
}

export { ProviderError };
