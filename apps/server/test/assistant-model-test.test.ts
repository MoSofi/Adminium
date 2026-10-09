// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Test the assistant with this model": the small turn that finds, when a
 * model is chosen, whether it can run the assistant at all.
 *
 * Scripted here; the proof against real models is the walk in the plan's log
 * (one that follows the format, one that answers in its own tool format).
 */
import { ASSISTANT_SCHEMA_VERSION } from '@adminium/llm';
import { describe, expect, it } from 'vitest';

import { ASSISTANT_MODEL_TEST_ROUNDS, testAssistantModel } from '../src/assistant/model-test.js';
import { makeScriptedClient, ProviderError, type ScriptStep } from './llm-fixtures.js';

const turn = (move: Record<string, unknown>, say = '') => ({ text: JSON.stringify({ schema_version: ASSISTANT_SCHEMA_VERSION, say, ...move }) });
const ping = turn({ calls: [{ id: 'c1', tool: 'ping', args: {}, step: { icon: 'search', label: 'Ping', detail: '' } }] });

async function test(script: readonly ScriptStep[]) {
  const scripted = makeScriptedClient(script);
  const result = await testAssistantModel({ client: scripted.client, provider: 'ollama', model: 'm', name: 'Milo', value: 4711, now: () => 0 });
  return { result, scripted };
}

describe('testing a model with the assistant', () => {
  it('passes a model that calls the tool and says what it answered', async () => {
    const { result, scripted } = await test([ping, turn({}, 'The number is 4711.')]);
    expect(result).toMatchObject({ ok: true, failure: null, rounds: 2 });
    // It was shown the real prompt of a page that drafts nothing, and the tool's answer.
    expect(scripted.calls[0]!.system).toContain('- ping:');
    expect(scripted.calls[0]!.system).not.toContain('== The document format ==');
    expect(scripted.calls[1]!.messages.at(-1)!.content).toContain('4711');
  });

  it('passes one that slipped once and was put right', async () => {
    const { result } = await test([{ text: 'Sure! Let me call ping.' }, ping, turn({}, '4711')]);
    expect(result).toMatchObject({ ok: true, rounds: 3 });
  });

  it('names a model that answers in its own tool format, or in prose, as one that cannot follow the format', async () => {
    const native = { throw: new ProviderError({ provider: 'ollama', code: 'empty_response', message: 'no text', toolCalls: ['ping'] }) };
    expect((await test([native])).result).toMatchObject({ ok: false, failure: 'format' });
    expect((await test([{ text: 'The number is probably 7.' }])).result).toMatchObject({ ok: false, failure: 'format' });
  });

  it('names one that answered without the tool, and one that used it and said something else', async () => {
    expect((await test([turn({}, 'The number is 4711.')])).result).toMatchObject({ ok: false, failure: 'no-tool' });
    expect((await test([ping, turn({}, 'The number is 12.')])).result).toMatchObject({ ok: false, failure: 'wrong-value' });
  });

  it('says so when it is the provider that failed, in the provider`s words', async () => {
    const { result } = await test([{ throw: new ProviderError({ provider: 'ollama', code: 'network', message: 'ollama: connection refused' }) }]);
    expect(result).toMatchObject({ ok: false, failure: 'provider', message: 'ollama: connection refused' });
  });

  it('never makes more provider calls than its cap, whatever the model does', async () => {
    // A model that calls the tool for ever.
    const { result, scripted } = await test([ping]);
    expect(scripted.calls).toHaveLength(ASSISTANT_MODEL_TEST_ROUNDS);
    expect(result.ok).toBe(false);
    expect(result.rounds).toBe(ASSISTANT_MODEL_TEST_ROUNDS);
  });
});
