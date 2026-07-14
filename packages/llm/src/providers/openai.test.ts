/**
 * OpenAI client — mocked-fetch wire tests (06-llm-assist.md §3.1): Bearer auth,
 * /v1/chat/completions body with the system message prepended, response parsing,
 * temperature-0 enforcement, chat-model filtering + static fallback.
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
      max_tokens: 16000,
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

describe('createOpenAiClient.listModels', () => {
  it('filters to chat models and labels by id, excluding o-series reasoning models', async () => {
    // o4-mini is a reasoning model: the fixed max_tokens + temperature:0 body
    // (a §3.1 mandate) always 400s on it, so it must not be offered.
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
