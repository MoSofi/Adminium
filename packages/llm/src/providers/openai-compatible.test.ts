/**
 * OpenAI-compatible client — mocked-fetch wire tests (06-llm-assist.md §3.1):
 * user-supplied baseUrl + /chat/completions, optional Bearer, and the key
 * behaviour — a 404 on the model-list endpoint is tolerated → free-text model.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenAiCompatibleClient } from './openai-compatible.js';
import { ProviderError } from './types.js';

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createOpenAiCompatibleClient', () => {
  it('requires a baseUrl', () => {
    expect(() => createOpenAiCompatibleClient({ provider: 'openai-compatible' })).toThrow(ProviderError);
  });

  it('POSTs to {baseUrl}/chat/completions and trims a trailing slash', async () => {
    const calls = stubFetch(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const client = createOpenAiCompatibleClient({
      provider: 'openai-compatible',
      baseUrl: 'https://groq.example/openai/v1/',
      apiKey: 'gsk_x',
      model: 'llama-3.1-70b',
    });

    await client.complete({ system: 's', messages: [{ role: 'user', content: 'q' }], model: 'llama-3.1-70b', maxTokens: 100, temperature: 0 });

    const call = calls[0];
    if (!call) throw new Error('fetch not called');
    expect(call.url).toBe('https://groq.example/openai/v1/chat/completions');
    expect((call.init.headers as Record<string, string>)['authorization']).toBe('Bearer gsk_x');
  });

  it('omits the Authorization header when no key is supplied', async () => {
    const calls = stubFetch(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const client = createOpenAiCompatibleClient({
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:1234/v1',
      model: 'local-model',
    });

    await client.complete({ system: '', messages: [{ role: 'user', content: 'q' }], model: 'local-model', maxTokens: 10, temperature: 0 });
    const call = calls[0];
    if (!call) throw new Error('fetch not called');
    expect((call.init.headers as Record<string, string>)['authorization']).toBeUndefined();
  });

  it('tolerates a 404 on the model-list endpoint → empty list (free-text model)', async () => {
    stubFetch(jsonResponse({ error: 'not found' }, 404));
    const client = createOpenAiCompatibleClient({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234/v1' });
    expect(await client.listModels()).toEqual([]);
  });

  it('propagates a non-404 model-list failure', async () => {
    stubFetch(jsonResponse({ error: 'boom' }, 500));
    const client = createOpenAiCompatibleClient({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234/v1' });
    await expect(client.listModels()).rejects.toMatchObject({ code: 'server', status: 500 });
  });

  it('maps a live model list', async () => {
    stubFetch(jsonResponse({ data: [{ id: 'llama-3.1-70b' }, { id: 'mixtral-8x7b' }] }));
    const client = createOpenAiCompatibleClient({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234/v1' });
    expect(await client.listModels()).toEqual([
      { id: 'llama-3.1-70b', label: 'llama-3.1-70b' },
      { id: 'mixtral-8x7b', label: 'mixtral-8x7b' },
    ]);
  });
});
