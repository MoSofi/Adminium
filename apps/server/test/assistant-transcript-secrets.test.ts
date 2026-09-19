// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The key never reaches the transcript.
 *
 * 06 acceptance #10 says the API key appears in no reply, no log line and no
 * progress event; this surface adds a FOURTH place it could land, and one the
 * others' tests cannot see. A turn stores its whole conversation — every
 * message that went to the provider and came back — in
 * `adminium_assistant_turns.transcript`, so that the next turn can replay it.
 * A key in there would sit in the database for as long as retention keeps the
 * session, readable by anything that can read the row.
 *
 * WHAT IS ACTUALLY AT RISK. The transcript holds `user` and `assistant`
 * messages only — never the system prompt, never the provider config. So the
 * claim under test is that the runner's OWN writes carry nothing from the
 * client it was handed, and that a model which echoes a credential back is
 * still stored verbatim (there is nothing else honest to do with a reply) but
 * is never joined by one the runner added.
 *
 * It is a unit test rather than a route test because the key never travels as
 * a request field: it is decrypted inside `resolveProviderClient` and handed
 * to a client object. Reaching it from a route would prove the route, not the
 * runner.
 */
import { describe, expect, it } from 'vitest';

import { runAssistantTurn, type TurnMessage } from '../src/assistant/turn-runner.js';
import type { AssistantContextAdapter } from '../src/assistant/types.js';
import type { ProviderClient } from '@adminium/llm';

const KEY = 'sk-ant-this-is-the-secret-key-0123456789';

const SAY = JSON.stringify({
  schema_version: 'adminium.assistant/v1',
  say: 'Nothing to draft here.',
});

/**
 * A client that HOLDS the key, as a real one does, and is asked for the
 * system prompt and the messages exactly as the runner sends them.
 */
function clientHoldingKey(seen: { system: string; messages: readonly TurnMessage[] }[]): ProviderClient {
  return {
    id: 'openai-compatible',
    apiKey: KEY,
    complete: (request: { system: string; messages: readonly TurnMessage[] }) => {
      seen.push({ system: request.system, messages: request.messages as readonly TurnMessage[] });
      return Promise.resolve({ text: SAY, usage: { inputTokens: 10, outputTokens: 5 } });
    },
    listModels: () => Promise.resolve([]),
    test: () => Promise.resolve({ ok: true, model: 'fake', latencyMs: 1, error: null }),
  } as unknown as ProviderClient;
}

function stubContext(): AssistantContextAdapter {
  return {
    key: 'email',
    pageLabel: 'Email templates',
    toolNames: [],
    pageFacts: () => Promise.resolve({ values: {}, scope: { primary: '', extra: 0 }, prompt: '' }),
    formatSpec: () => 'FORMAT',
    examples: () => [],
    acceptArtefact: (artefact) => Promise.resolve({ ok: true, artefact }),
    projectForDiff: () => [],
    baseForDiff: () => Promise.resolve(null),
    details: () => [],
  };
}

describe('the stored transcript', () => {
  it('carries nothing the provider client was holding', async () => {
    const seen: { system: string; messages: readonly TurnMessage[] }[] = [];
    const events: string[] = [];
    const outcome = await runAssistantTurn({
      client: clientHoldingKey(seen),
      model: 'fake',
      provider: 'openai-compatible',
      maxTokens: 1000,
      system: 'You are Milo.',
      pageFacts: { templates: 2 },
      messages: [{ role: 'user', content: 'Draft a reminder' }],
      context: stubContext(),
      execute: () => Promise.resolve({ result: {} }),
      accept: (artefact) => Promise.resolve({ ok: true, artefact }),
      onStep: (event) => {
        events.push(JSON.stringify(event));
      },
    });

    // The client really was holding it, so a leak was possible.
    expect((clientHoldingKey([]) as unknown as { apiKey: string }).apiKey).toBe(KEY);

    const stored = JSON.stringify(outcome.messages);
    expect(stored).not.toContain(KEY);
    expect(stored).not.toContain('sk-ant');
    // And the two other channels this turn writes to.
    expect(events.join('')).not.toContain(KEY);
    expect(JSON.stringify(outcome.steps)).not.toContain(KEY);

    // The system prompt is what the runner SENDS and never what it stores —
    // the transcript is user and assistant messages only, so a prompt that
    // one day carried a credential still could not land in the row.
    expect(seen[0]?.system).toBe('You are Milo.');
    expect(outcome.messages.every((message) => message.role === 'user' || message.role === 'assistant')).toBe(true);
  });

  it('stores a reply that echoes a credential, and adds none of its own', async () => {
    const leaky = {
      id: 'openai-compatible',
      complete: () =>
        Promise.resolve({
          text: JSON.stringify({ schema_version: 'adminium.assistant/v1', say: `I was given ${KEY}` }),
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      listModels: () => Promise.resolve([]),
      test: () => Promise.resolve({ ok: true, model: 'fake', latencyMs: 1, error: null }),
    } as unknown as ProviderClient;

    const outcome = await runAssistantTurn({
      client: leaky,
      model: 'fake',
      provider: 'openai-compatible',
      maxTokens: 1000,
      system: 'You are Milo.',
      messages: [{ role: 'user', content: 'What were you given?' }],
      context: stubContext(),
      execute: () => Promise.resolve({ result: {} }),
      accept: (artefact) => Promise.resolve({ ok: true, artefact }),
    });

    // A model that says a secret back is storing ITS words, and rewriting a
    // reply would make the transcript a worse record of what happened. What
    // matters is that exactly ONE message holds it — the model's — and the
    // runner contributed none.
    const holders = outcome.messages.filter((message) => message.content.includes(KEY));
    expect(holders).toHaveLength(1);
    expect(holders[0]?.role).toBe('assistant');
  });
});
