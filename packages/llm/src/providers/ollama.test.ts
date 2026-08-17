// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ollama client — mocked-fetch wire tests (06-llm-assist.md §3.1): default
 * localhost baseUrl, no auth, POST /api/chat with temperature in `options`, and
 * GET /api/tags → model list (no static fallback).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOllamaClient } from './ollama.js';

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

describe('createOllamaClient.complete', () => {
  it('POSTs /api/chat to the default localhost baseUrl with temperature in options and no auth', async () => {
    const calls = stubFetch(
      jsonResponse({ message: { content: 'local answer' }, prompt_eval_count: 8, eval_count: 4 }),
    );
    const client = createOllamaClient({ provider: 'ollama', model: 'llama3.2' });

    const result = await client.complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      model: 'llama3.2',
      maxTokens: 16000,
      temperature: 0,
    });

    const call = calls[0];
    if (!call) throw new Error('fetch not called');
    expect(call.url).toBe('http://localhost:11434/api/chat');
    expect((call.init.headers as Record<string, string>)['authorization']).toBeUndefined();

    const body = JSON.parse(call.init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'llama3.2',
      stream: false,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
      ],
      options: { temperature: 0, num_predict: 16000 },
    });
    expect(result).toEqual({ text: 'local answer', usage: { inputTokens: 8, outputTokens: 4 } });
  });

  it('honours a custom baseUrl and enforces temperature 0', async () => {
    stubFetch(jsonResponse({ message: { content: 'x' } }));
    const client = createOllamaClient({ provider: 'ollama', baseUrl: 'http://ollama.internal:11434/', model: 'llama3.2' });
    await expect(
      client.complete({ system: '', messages: [], model: 'llama3.2', maxTokens: 1, temperature: 0.5 }),
    ).rejects.toMatchObject({ code: 'config' });
  });
});

describe('createOllamaClient.listModels', () => {
  it('maps /api/tags names to model info', async () => {
    const calls = stubFetch(jsonResponse({ models: [{ name: 'llama3.2:latest' }, { name: 'qwen2.5' }] }));
    const client = createOllamaClient({ provider: 'ollama' });

    const models = await client.listModels();
    const call = calls[0];
    if (!call) throw new Error('fetch not called');
    expect(call.url).toBe('http://localhost:11434/api/tags');
    expect(models).toEqual([
      { id: 'llama3.2:latest', label: 'llama3.2:latest' },
      { id: 'qwen2.5', label: 'qwen2.5' },
    ]);
  });

  it('propagates a failure (no static fallback for local models)', async () => {
    stubFetch(jsonResponse({}, 500));
    const client = createOllamaClient({ provider: 'ollama' });
    await expect(client.listModels()).rejects.toMatchObject({ code: 'server', status: 500, provider: 'ollama' });
  });
});
