// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Direct-path runner mechanics (06-llm-assist.md §7.5, acceptance #6 + #7).
 *
 * Pure — no meta store, no jobs runtime, a scripted fake provider. Covers the
 * repair loop, the `LLM_TRUNCATED` maxTokens escalation (no repair consumed), the
 * 3-consecutive-failures rule, the order-independent chunk map-reduce, and
 * cooperative cancellation.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  buildRepairMessage,
  countSuggestions,
  DEFAULT_MAX_REPAIRS,
  runDirectPath,
  type RunnerChunk,
  type RunnerPhase,
} from '../src/llm/direct-runner.js';
import {
  makeScriptedClient,
  makeValidate,
  MALFORMED_REPLY,
  ordersSchema,
  ordersStats,
  ProviderError,
  TRUNCATED_REPLY,
  twoTableSchema,
  validOrdersResponse,
  validTableResponse,
  type ScriptStep,
} from './llm-fixtures.js';

const RUN_ID = 'run_test';

function oneChunk(): RunnerChunk[] {
  return [{ index: 1, total: 1, system: 'SYS', user: 'USER' }];
}

function run(script: readonly ScriptStep[], overrides: Partial<Parameters<typeof runDirectPath>[0]> = {}) {
  const scripted = makeScriptedClient(script);
  const events: RunnerPhase[] = [];
  const promise = runDirectPath({
    chunks: oneChunk(),
    client: scripted.client,
    model: 'claude-x',
    provider: 'anthropic',
    maxTokens: 100,
    maxTokensCeiling: 4000,
    validate: makeValidate(ordersSchema, RUN_ID, ordersStats),
    onProgress: (event) => events.push(event),
    ...overrides,
  });
  return { scripted, events, promise };
}

describe('runDirectPath — happy path', () => {
  it('validates a clean reply and records token usage', async () => {
    const { scripted, events, promise } = run([
      { text: validOrdersResponse(RUN_ID), usage: { inputTokens: 1200, outputTokens: 340 } },
    ]);
    const outcome = await promise;

    expect(outcome.status).toBe('validated');
    if (outcome.status !== 'validated') return;
    expect(outcome.tokensIn).toBe(1200);
    expect(outcome.tokensOut).toBe(340);
    expect(outcome.chunksReceived).toBe(1);
    expect(outcome.errors).toEqual([]);
    expect(outcome.response.tables).toHaveLength(1);

    // Temperature is pinned to 0 (§3.1 determinism mandate).
    expect(scripted.calls).toHaveLength(1);
    expect(scripted.calls[0]?.temperature).toBe(0);

    const phases = events.map((event) => event.phase);
    expect(phases).toEqual(['building', 'sending', 'validating', 'chunk-done', 'done']);
    const done = events.at(-1);
    expect(done).toMatchObject({ phase: 'done' });
    if (done?.phase === 'done') expect(done.suggestions).toBeGreaterThan(0);
  });
});

describe('runDirectPath — repair loop (§7.5)', () => {
  it('repairs a malformed first reply within one repair turn', async () => {
    const { scripted, events, promise } = run([
      { text: MALFORMED_REPLY },
      { text: validOrdersResponse(RUN_ID) },
    ]);
    const outcome = await promise;

    expect(outcome.status).toBe('validated');
    expect(scripted.calls).toHaveLength(2);

    // The repair turn carries the model's bad output + the §7.5 user message.
    const repairMessages = scripted.calls[1]?.messages ?? [];
    expect(repairMessages).toHaveLength(3);
    expect(repairMessages[0]).toEqual({ role: 'user', content: 'USER' });
    expect(repairMessages[1]).toEqual({ role: 'assistant', content: MALFORMED_REPLY });
    expect(repairMessages[2]?.role).toBe('user');
    expect(repairMessages[2]?.content).toContain('Your previous response failed machine validation:');
    expect(repairMessages[2]?.content).toContain('LLM_JSON_PARSE');

    const repairing = events.find((event) => event.phase === 'repairing');
    expect(repairing).toMatchObject({ phase: 'repairing', attempt: 1, maxAttempts: DEFAULT_MAX_REPAIRS });
  });

  it('fails after three consecutive failures, preserving the last error list', async () => {
    const { scripted, events, promise } = run([
      { text: MALFORMED_REPLY },
      { text: MALFORMED_REPLY },
      { text: MALFORMED_REPLY },
    ]);
    const outcome = await promise;

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    // Initial attempt + 2 repairs = 3 provider calls.
    expect(scripted.calls).toHaveLength(3);
    expect(outcome.errors.length).toBeGreaterThan(0);
    expect(outcome.errors[0]).toMatchObject({ code: 'LLM_JSON_PARSE' });

    // Exactly two repair turns were attempted, then it gave up.
    const repairAttempts = events.filter((event) => event.phase === 'repairing');
    expect(repairAttempts.map((event) => (event as { attempt: number }).attempt)).toEqual([1, 2]);
    expect(outcome.chunksReceived).toBe(0);
  });
});

describe('runDirectPath — LLM_TRUNCATED escalation (§7.5)', () => {
  it('raises maxTokens to the ceiling and retries without consuming a repair', async () => {
    const { scripted, events, promise } = run([
      { text: TRUNCATED_REPLY },
      { text: validOrdersResponse(RUN_ID) },
    ]);
    const outcome = await promise;

    expect(outcome.status).toBe('validated');
    expect(scripted.calls).toHaveLength(2);
    // First at the initial budget, second raised to the ceiling.
    expect(scripted.calls[0]?.maxTokens).toBe(100);
    expect(scripted.calls[1]?.maxTokens).toBe(4000);
    // No repair turn — the retry re-sends the same single user message.
    expect(scripted.calls[1]?.messages).toHaveLength(1);

    const phases = events.map((event) => event.phase);
    expect(phases).toContain('truncation-retry');
    expect(phases).not.toContain('repairing');
  });

  it('counts a second truncation as a repair once already at the ceiling', async () => {
    const { scripted, promise } = run(
      [{ text: TRUNCATED_REPLY }],
      { maxTokens: 4000, maxTokensCeiling: 4000 },
    );
    const outcome = await promise;

    // Cannot raise further → truncation immediately consumes repairs → failed.
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.errors[0]).toMatchObject({ code: 'LLM_TRUNCATED' });
    // initial + 2 repairs, all truncated.
    expect(scripted.calls).toHaveLength(1 + DEFAULT_MAX_REPAIRS);
    scripted.calls.forEach((call) => expect(call.maxTokens).toBe(4000));
  });
});

describe('runDirectPath — provider transport failure', () => {
  it('fails the run on a ProviderError without repairing', async () => {
    const error = new ProviderError({ provider: 'anthropic', code: 'network', message: 'connection refused' });
    const { scripted, promise } = run([{ throw: error }]);
    const outcome = await promise;

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(scripted.calls).toHaveLength(1);
    expect(outcome.errors[0]).toMatchObject({ kind: 'provider', code: 'network', provider: 'anthropic' });
  });
});

describe('runDirectPath — chunked map-reduce (§4.5, acceptance #7)', () => {
  it('runs each chunk, updates chunks_received, and merges order-independently', async () => {
    const chunks: RunnerChunk[] = [
      { index: 1, total: 2, system: 'SYS', user: 'USER-A' },
      { index: 2, total: 2, system: 'SYS', user: 'USER-B' },
    ];
    const scripted = makeScriptedClient([
      { text: validTableResponse('public.orders', 'order_number') },
      { text: validTableResponse('public.customers', 'email') },
    ]);
    const received: number[] = [];

    const outcome = await runDirectPath({
      chunks,
      client: scripted.client,
      model: 'claude-x',
      provider: 'anthropic',
      maxTokens: 4000,
      maxTokensCeiling: 4000,
      validate: makeValidate(twoTableSchema, RUN_ID),
      onChunkComplete: (n) => {
        received.push(n);
      },
    });

    expect(outcome.status).toBe('validated');
    if (outcome.status !== 'validated') return;
    expect(scripted.calls).toHaveLength(2);
    expect(received).toEqual([1, 2]);
    expect(outcome.chunksReceived).toBe(2);
    const tables = outcome.response.tables.map((table) => table.table).sort();
    expect(tables).toEqual(['public.customers', 'public.orders']);
  });
});

describe('runDirectPath — cancellation', () => {
  it('returns cancelled without a provider call when aborted upfront', async () => {
    const controller = new AbortController();
    controller.abort();
    const scripted = makeScriptedClient([{ text: validOrdersResponse(RUN_ID) }]);

    const outcome = await runDirectPath({
      chunks: oneChunk(),
      client: scripted.client,
      model: 'claude-x',
      provider: 'anthropic',
      maxTokens: 100,
      maxTokensCeiling: 4000,
      validate: makeValidate(ordersSchema, RUN_ID),
      signal: controller.signal,
    });

    expect(outcome.status).toBe('cancelled');
    expect(scripted.calls).toHaveLength(0);
  });

  it('returns cancelled after a chunk when aborted mid-flight', async () => {
    const controller = new AbortController();
    const scripted = makeScriptedClient([{ text: validOrdersResponse(RUN_ID) }], {
      beforeReply: () => {
        controller.abort();
      },
    });

    const outcome = await runDirectPath({
      chunks: oneChunk(),
      client: scripted.client,
      model: 'claude-x',
      provider: 'anthropic',
      maxTokens: 100,
      maxTokensCeiling: 4000,
      validate: makeValidate(ordersSchema, RUN_ID),
      signal: controller.signal,
    });

    // The single chunk completed, but the post-loop abort check wins → cancelled.
    expect(outcome.status).toBe('cancelled');
  });
});

describe('runDirectPath helpers', () => {
  it('buildRepairMessage renders the §7.5 message verbatim with the error list', () => {
    const message = buildRepairMessage([
      { code: 'LLM_SCHEMA_INVALID', severity: 'fatal', path: 'tables[0].confidence', message: 'Expected number' },
    ]);
    expect(message).toContain('Your previous response failed machine validation:');
    expect(message).toContain('- LLM_SCHEMA_INVALID, tables[0].confidence, Expected number');
    expect(message).toContain('Return the corrected COMPLETE JSON object now. Output rules still apply:');
    expect(message).toContain('single JSON object, no prose, no fences, schema_version first.');
  });

  it('buildRepairMessage caps the error list at 20', () => {
    const errors = Array.from({ length: 30 }, (_unused, i) => ({
      code: 'LLM_SCHEMA_INVALID' as const,
      severity: 'fatal' as const,
      path: `tables[${i}]`,
      message: 'bad',
    }));
    const message = buildRepairMessage(errors);
    const lines = message.split('\n').filter((line) => line.startsWith('- '));
    expect(lines).toHaveLength(20);
  });

  it('countSuggestions is deterministic', () => {
    const validate = makeValidate(ordersSchema, RUN_ID, ordersStats);
    const result = validate(validOrdersResponse(RUN_ID));
    expect(result.response).toBeDefined();
    if (result.response === undefined) return;
    // 1 table + 2 columns.
    expect(countSuggestions(result.response)).toBe(3);
  });

  it('never invokes the validator when there are no chunks', async () => {
    const validate = vi.fn();
    const scripted = makeScriptedClient([{ text: validOrdersResponse(RUN_ID) }]);
    const outcome = await runDirectPath({
      chunks: [],
      client: scripted.client,
      model: 'm',
      provider: 'anthropic',
      maxTokens: 100,
      maxTokensCeiling: 4000,
      validate,
    });
    expect(outcome.status).toBe('validated');
    expect(validate).not.toHaveBeenCalled();
    expect(scripted.calls).toHaveLength(0);
  });
});
