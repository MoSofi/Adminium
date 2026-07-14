/**
 * Anthropic client — mocked-fetch wire tests (06-llm-assist.md §3.1). Locks the
 * exact request shape (URL, x-api-key + anthropic-version headers, Messages body),
 * response parsing, temperature-0 enforcement, error mapping, model-list fallback,
 * and — acceptance §10 — that the API key never reaches an error surface.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAnthropicClient } from './anthropic.js';
import { ANTHROPIC_STATIC_MODELS } from './model-catalog.js';
import { ProviderError } from './types.js';

const KEY = 'sk-ant-secret-DO-NOT-LEAK';

interface Captured {
  url: string;
  init: RequestInit;
}

function stubFetch(response: Response | (() => Response | Promise<Response>)): {
  fetchMock: ReturnType<typeof vi.fn>;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return typeof response === 'function' ? response() : response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const OK_BODY = {
  content: [
    { type: 'text', text: 'Hello ' },
    { type: 'text', text: 'world' },
  ],
  usage: { input_tokens: 12, output_tokens: 3 },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createAnthropicClient.complete', () => {
  it('POSTs /v1/messages with the exact headers and Messages body', async () => {
    const { calls } = stubFetch(jsonResponse(OK_BODY));
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-opus-4-8' });

    const result = await client.complete({
      system: 'You are a data architect.',
      messages: [{ role: 'user', content: 'schema here' }],
      model: 'claude-opus-4-8',
      maxTokens: 16000,
      temperature: 0,
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error('fetch not called');
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.init.method).toBe('POST');

    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['content-type']).toBe('application/json');

    const body = JSON.parse(call.init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      temperature: 0,
      system: 'You are a data architect.',
      messages: [{ role: 'user', content: 'schema here' }],
    });

    expect(result).toEqual({ text: 'Hello world', usage: { inputTokens: 12, outputTokens: 3 } });
  });

  it('rejects a non-zero temperature before any request (determinism guard)', async () => {
    const { fetchMock } = stubFetch(jsonResponse(OK_BODY));
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-opus-4-8' });

    await expect(
      client.complete({ system: '', messages: [], model: 'claude-opus-4-8', maxTokens: 100, temperature: 0.7 }),
    ).rejects.toMatchObject({ name: 'ProviderError', code: 'config' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps 401 to a ProviderError with code "auth" and status 401', async () => {
    stubFetch(jsonResponse({ error: { message: 'invalid key' } }, 401));
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-opus-4-8' });

    await expect(
      client.complete({ system: '', messages: [{ role: 'user', content: 'x' }], model: 'claude-opus-4-8', maxTokens: 1, temperature: 0 }),
    ).rejects.toMatchObject({ name: 'ProviderError', code: 'auth', status: 401, provider: 'anthropic' });
  });

  it('throws bad_response when no text content is returned', async () => {
    stubFetch(jsonResponse({ content: [], usage: {} }));
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-opus-4-8' });

    await expect(
      client.complete({ system: '', messages: [{ role: 'user', content: 'x' }], model: 'claude-opus-4-8', maxTokens: 1, temperature: 0 }),
    ).rejects.toMatchObject({ code: 'bad_response' });
  });
});

describe('createAnthropicClient — key is never leaked (acceptance §10)', () => {
  it('scrubs the API key out of an error body that echoes it', async () => {
    stubFetch(jsonResponse({ error: `bad token ${KEY}` }, 403));
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-opus-4-8' });

    const err = await client
      .complete({ system: '', messages: [{ role: 'user', content: 'x' }], model: 'claude-opus-4-8', maxTokens: 1, temperature: 0 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderError);
    const message = (err as ProviderError).message;
    expect(message).not.toContain(KEY);
    expect(message).toContain('[REDACTED]');
  });

  it('scrubs the API key out of a network-failure message', async () => {
    const calls: Captured[] = [];
    const fetchMock = vi.fn(async (url: unknown) => {
      calls.push({ url: String(url), init: {} });
      throw new Error(`ECONNREFUSED while sending ${KEY}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-opus-4-8' });

    const err = await client
      .complete({ system: '', messages: [{ role: 'user', content: 'x' }], model: 'claude-opus-4-8', maxTokens: 1, temperature: 0 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe('network');
    expect((err as ProviderError).message).not.toContain(KEY);
  });
});

describe('createAnthropicClient.listModels', () => {
  it('maps the live /v1/models response', async () => {
    const { calls } = stubFetch(
      jsonResponse({ data: [{ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }, { id: 'claude-haiku-4-5' }] }),
    );
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-opus-4-8' });

    const models = await client.listModels();
    const call = calls[0];
    if (!call) throw new Error('fetch not called');
    expect(call.url).toBe('https://api.anthropic.com/v1/models');
    expect((call.init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expect(models).toEqual([
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
    ]);
  });

  it('falls back to the static list when the live fetch fails', async () => {
    stubFetch(jsonResponse({ error: 'boom' }, 500));
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-opus-4-8' });

    const models = await client.listModels();
    expect(models).toEqual([...ANTHROPIC_STATIC_MODELS]);
  });
});

describe('createAnthropicClient config guards', () => {
  it('requires an API key at construction', () => {
    expect(() => createAnthropicClient({ provider: 'anthropic' })).toThrow(ProviderError);
  });

  it('test() requires a configured model', async () => {
    stubFetch(jsonResponse(OK_BODY));
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY });
    await expect(client.test()).rejects.toMatchObject({ code: 'config' });
  });
});
