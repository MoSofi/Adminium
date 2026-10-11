// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OpenAI client — mocked-fetch wire tests: Bearer auth, /v1/chat/completions
 * body with the system message prepended, response parsing, temperature-0
 * enforcement, chat-model filtering + static fallback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenAiClient } from './openai.js';
import { OPENAI_STATIC_MODELS } from './model-catalog.js';
import { ProviderError } from './types.js';

const KEY = 'sk-openai-secret';

interface Captured {
  url: string;
  init: RequestInit;
}

function stubFetch(response: Response): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response;
    }),
  );
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const OK_BODY = {
  choices: [{ message: { content: 'the answer' } }],
  usage: { prompt_tokens: 20, completion_tokens: 5 },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createOpenAiClient.complete', () => {
  it('POSTs /chat/completions with Bearer auth and system prepended', async () => {
    const calls = stubFetch(jsonResponse(OK_BODY));
    const client = createOpenAiClient({ provider: 'openai', apiKey: KEY, model: 'gpt-4o' });

    const result = await client.complete({
      system: 'system prompt',
      messages: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
      ],
      model: 'gpt-4o',
      maxTokens: 16000,
      temperature: 0,
    });

    const call = calls[0];
    if (!call) throw new Error('fetch not called');
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect((call.init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${KEY}`);

    const body = JSON.parse(call.init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'gpt-4o',
      max_completion_tokens: 16000,
      temperature: 0,
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
      ],
    });
    expect(result).toEqual({ text: 'the answer', usage: { inputTokens: 20, outputTokens: 5 } });
  });

  it('omits the system message when system is empty', async () => {
    const calls = stubFetch(jsonResponse(OK_BODY));
    const client = createOpenAiClient({ provider: 'openai', apiKey: KEY, model: 'gpt-4o' });

    await client.complete({ system: '', messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o', maxTokens: 1, temperature: 0 });
    const call = calls[0];
    if (!call) throw new Error('fetch not called');
    const body = JSON.parse(call.init.body as string) as { messages: unknown[] };
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('enforces temperature 0', async () => {
    const client = createOpenAiClient({ provider: 'openai', apiKey: KEY, model: 'gpt-4o' });
    await expect(
      client.complete({ system: '', messages: [], model: 'gpt-4o', maxTokens: 1, temperature: 1 }),
    ).rejects.toMatchObject({ code: 'config' });
  });

  it('maps 429 to rate_limit', async () => {
    stubFetch(jsonResponse({ error: 'slow down' }, 429));
    const client = createOpenAiClient({ provider: 'openai', apiKey: KEY, model: 'gpt-4o' });
    await expect(
      client.complete({ system: '', messages: [{ role: 'user', content: 'x' }], model: 'gpt-4o', maxTokens: 1, temperature: 0 }),
    ).rejects.toMatchObject({ code: 'rate_limit', status: 429 });
  });
});

describe('what the real service refuses (seen 2026-10-11 on gpt-6-luna)', () => {
  // The service's own words.
  const refusal = (param: string, message: string): Response => jsonResponse({ error: { message, type: 'invalid_request_error', param, code: 'unsupported_value' } }, 400);
  const noZero = (): Response => refusal('temperature', "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.");
  const serve = (...replies: (() => Response)[]): Record<string, unknown>[] => {
    const bodies: Record<string, unknown>[] = [];
    let next = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        const reply = replies[Math.min(next, replies.length - 1)] as () => Response;
        next += 1;
        return reply();
      }),
    );
    return bodies;
  };
  const ask = { system: '', messages: [{ role: 'user' as const, content: 'hi' }], model: 'gpt-6-luna', maxTokens: 50, temperature: 0 };

  it('never sends max_tokens to the official API: every model there takes max_completion_tokens', async () => {
    const bodies = serve(() => jsonResponse(OK_BODY));
    await createOpenAiClient({ provider: 'openai', apiKey: KEY, model: 'gpt-6-luna' }).complete(ask);
    expect(bodies[0]).not.toHaveProperty('max_tokens');
    expect(bodies[0]).toMatchObject({ max_completion_tokens: 50, temperature: 0 });
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');
  });

  it('a model that refuses temperature 0 is asked again with its reasoning off, and remembered', async () => {
    const bodies = serve(noZero, () => jsonResponse(OK_BODY));
    const client = createOpenAiClient({ provider: 'openai', apiKey: KEY, model: 'gpt-6-luna' });
    await client.complete(ask);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ reasoning_effort: 'none', temperature: 0, max_completion_tokens: 50 });
    await client.complete(ask);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).toMatchObject({ reasoning_effort: 'none', temperature: 0 });
    // Another model starts from the plain request.
    await client.complete({ ...ask, model: 'gpt-4o' });
    expect(bodies[3]).not.toHaveProperty('reasoning_effort');
  });

  it('a model that takes neither is asked with no temperature at all, and a third refusal is said as it is', async () => {
    const noEffort = (): Response => refusal('reasoning_effort', "Unsupported parameter: 'reasoning_effort' is not supported with this model.");
    const bodies = serve(noZero, noEffort, () => jsonResponse(OK_BODY));
    await createOpenAiClient({ provider: 'openai', apiKey: KEY, model: 'x' }).complete(ask);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).not.toHaveProperty('temperature');
    expect(bodies[2]).not.toHaveProperty('reasoning_effort');
    const again = serve(noZero, noEffort, noZero);
    await expect(createOpenAiClient({ provider: 'openai', apiKey: KEY, model: 'x' }).complete(ask)).rejects.toMatchObject({ status: 400 });
    expect(again).toHaveLength(3);
  });

  it('any other refusal is not asked twice', async () => {
    const bodies = serve(() => refusal('model', 'The model does not exist.'));
    await expect(createOpenAiClient({ provider: 'openai', apiKey: KEY, model: 'x' }).complete(ask)).rejects.toMatchObject({ status: 400 });
    expect(bodies).toHaveLength(1);
  });
});

describe('createOpenAiClient.listModels', () => {
  it('leaves out the gpt models that do not chat', async () => {
    stubFetch(jsonResponse({ data: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-5-mini', 'gpt-live-transcribe', 'gpt-realtime-2.1-mini', 'gpt-audio-mini-2025-10-06', 'gpt-4o-mini-tts', 'gpt-image-2.5-flare', 'gpt-5-search-api', 'gpt-live-1'].map((id) => ({ id })) }));
    const models = await createOpenAiClient({ provider: 'openai', apiKey: KEY, model: 'gpt-6-luna' }).listModels();
    expect(models.map((model) => model.id)).toEqual(['gpt-6-luna', 'gpt-6.1-sol', 'gpt-5-mini']);
  });

  it('filters to chat models and labels by id, excluding o-series reasoning models', async () => {
    // o4-mini is a reasoning model with no way to turn its reasoning off: temperature 0
    // (a mandate) always 400s on it, so it must not be offered.
    const calls = stubFetch(
      jsonResponse({ data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3-small' }, { id: 'o4-mini' }, { id: 'whisper-1' }] }),
    );
    const client = createOpenAiClient({ provider: 'openai', apiKey: KEY, model: 'gpt-4o' });

    const models = await client.listModels();
    const call = calls[0];
    if (!call) throw new Error('fetch not called');
    expect(call.url).toBe('https://api.openai.com/v1/models');
    expect(models).toEqual([{ id: 'gpt-4o', label: 'gpt-4o' }]);
  });

  it('offers no o-series model in the static fallback list', () => {
    expect(OPENAI_STATIC_MODELS.some((m) => /^o\d/i.test(m.id))).toBe(false);
  });

  it('falls back to the static list on failure', async () => {
    stubFetch(jsonResponse({}, 500));
    const client = createOpenAiClient({ provider: 'openai', apiKey: KEY, model: 'gpt-4o' });
    expect(await client.listModels()).toEqual([...OPENAI_STATIC_MODELS]);
  });
});

describe('createOpenAiClient config guards', () => {
  it('requires an API key', () => {
    expect(() => createOpenAiClient({ provider: 'openai' })).toThrow(ProviderError);
  });
});
