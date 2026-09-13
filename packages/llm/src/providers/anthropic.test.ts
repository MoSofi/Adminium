// SPDX-License-Identifier: AGPL-3.0-only
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
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-sonnet-4-6' });

    const result = await client.complete({
      system: 'You are a data architect.',
      messages: [{ role: 'user', content: 'schema here' }],
      model: 'claude-sonnet-4-6',
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
      model: 'claude-sonnet-4-6',
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

  it('throws empty_response when no text content is returned', async () => {
    stubFetch(jsonResponse({ content: [], usage: {} }));
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-opus-4-8' });

    await expect(
      client.complete({ system: '', messages: [{ role: 'user', content: 'x' }], model: 'claude-opus-4-8', maxTokens: 1, temperature: 0 }),
    ).rejects.toMatchObject({ code: 'empty_response' });
  });
});

/*
 * The bug this locks: `temperature: 0` on Sonnet 5 answers
 * `HTTP 400 — \`temperature\` is deprecated for this model`, which failed the
 * connection test and then every chunk of the enrichment run behind it.
 */
describe('createAnthropicClient — sampling parameters by generation', () => {
  async function bodyFor(model: string): Promise<Record<string, unknown>> {
    const { calls } = stubFetch(jsonResponse(OK_BODY));
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model });
    await client.complete({
      system: 's',
      messages: [{ role: 'user', content: 'q' }],
      model,
      maxTokens: 100,
      temperature: 0,
    });
    const call = calls[0];
    if (!call) throw new Error('fetch not called');
    return JSON.parse(call.init.body as string) as Record<string, unknown>;
  }

  it.each(['claude-sonnet-5', 'claude-opus-5', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-fable-5-1'])(
    'omits temperature for %s',
    async (model) => {
      const body = await bodyFor(model);
      expect('temperature' in body).toBe(false);
      expect(body['model']).toBe(model);
    },
  );

  it.each(['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5', 'claude-3-5-sonnet-20241022'])(
    'still pins temperature 0 for %s',
    async (model) => {
      expect(await bodyFor(model)).toMatchObject({ temperature: 0 });
    },
  );

  it('omits temperature for a model id it has never seen', async () => {
    // The model list is fetched live from the caller's account, so an unknown
    // id is routine — and every generation since 4.7 has dropped sampling.
    expect('temperature' in (await bodyFor('claude-something-new'))).toBe(false);
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

/*
 * "Test connection" answers one question — can this key reach this model — and
 * a reasoning model can answer a 16-token ping entirely in thinking, returning
 * a perfectly good 200 with no text in it. That must read as a PASS; a bad key
 * must still read as a failure.
 */
describe('createAnthropicClient.test — the connectivity ping', () => {
  it('passes when the reply carries no assistant text', async () => {
    const { calls } = stubFetch(jsonResponse({ content: [], usage: { input_tokens: 4, output_tokens: 16 } }));
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-sonnet-5' });

    await expect(client.test()).resolves.toMatchObject({ ok: true, model: 'claude-sonnet-5' });

    const call = calls[0];
    if (!call) throw new Error('fetch not called');
    const body = JSON.parse(call.init.body as string) as Record<string, unknown>;
    expect(body['max_tokens']).toBe(16);
    expect('temperature' in body).toBe(false);
  });

  it('still fails on a bad key', async () => {
    stubFetch(jsonResponse({ error: { message: 'invalid key' } }, 401));
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-sonnet-5' });
    await expect(client.test()).rejects.toMatchObject({ code: 'auth', status: 401 });
  });

  it('still fails when the body is not JSON at all', async () => {
    stubFetch(new Response('<html>proxy error</html>', { status: 200 }));
    const client = createAnthropicClient({ provider: 'anthropic', apiKey: KEY, model: 'claude-sonnet-5' });
    await expect(client.test()).rejects.toMatchObject({ code: 'bad_response' });
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
