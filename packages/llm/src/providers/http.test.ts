// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared HTTP helper tests (06-llm-assist.md §3): secret scrubbing, non-2xx →
 * status-mapped ProviderError, network + timeout mapping, and bad_response on an
 * unparseable 2xx body.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestJson, scrubCause, scrubSecret } from './http.js';
import { ProviderError } from './types.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('scrubSecret', () => {
  it('replaces every occurrence of the secret', () => {
    expect(scrubSecret('key=abc123 and again abc123', 'abc123')).toBe('key=[REDACTED] and again [REDACTED]');
  });
  it('is a no-op without a secret', () => {
    expect(scrubSecret('nothing to hide', undefined)).toBe('nothing to hide');
    expect(scrubSecret('nothing to hide', '')).toBe('nothing to hide');
  });
});

describe('requestJson error mapping', () => {
  const cases: { status: number; code: string }[] = [
    { status: 401, code: 'auth' },
    { status: 403, code: 'auth' },
    { status: 404, code: 'not_found' },
    { status: 429, code: 'rate_limit' },
    { status: 500, code: 'server' },
    { status: 503, code: 'server' },
    { status: 418, code: 'http' },
  ];

  for (const { status, code } of cases) {
    it(`maps HTTP ${String(status)} to code "${code}"`, async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('body', { status })));
      const err = await requestJson({ provider: 'openai', url: 'https://x/y' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe(code);
      expect((err as ProviderError).status).toBe(status);
    });
  }

  it('maps a fetch rejection to "network"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }));
    const err = await requestJson({ provider: 'ollama', url: 'http://x/y' }).catch((e: unknown) => e);
    expect((err as ProviderError).code).toBe('network');
  });

  it('keeps the API key out of the network-error cause chain (acceptance §10)', async () => {
    const SECRET = 'sk-leak-me-in-the-cause';
    vi.stubGlobal('fetch', vi.fn(async () => {
      // A fetch impl whose error echoes the outgoing Authorization header.
      throw new Error(`ECONNREFUSED while sending Authorization: Bearer ${SECRET}`);
    }));
    const err = (await requestJson({ provider: 'openai', url: 'https://x/y', apiKey: SECRET }).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(err.message).not.toContain(SECRET);
    // The cause chain is what console.error / util.inspect / log serializers walk.
    const cause = err.cause;
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    const causeStack = cause instanceof Error ? (cause.stack ?? '') : '';
    expect(causeMessage).not.toContain(SECRET);
    expect(causeStack).not.toContain(SECRET);
  });
});

describe('scrubCause', () => {
  it('returns the original error when no secret is present', () => {
    const original = new Error('ECONNREFUSED');
    expect(scrubCause(original, undefined)).toBe(original);
    expect(scrubCause(original, 'sk-x')).toBe(original); // secret absent from message/stack
  });

  it('replaces an error whose message contains the secret', () => {
    const leaked = scrubCause(new Error('sending sk-secret-abc'), 'sk-secret-abc');
    const message = leaked instanceof Error ? leaked.message : String(leaked);
    expect(message).toBe('sending [REDACTED]');
    expect(message).not.toContain('sk-secret-abc');
  });

  it('maps our own abort to "timeout"', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    }));
    const err = await requestJson({ provider: 'anthropic', url: 'https://x/y', timeoutMs: 5 }).catch((e: unknown) => e);
    expect((err as ProviderError).code).toBe('timeout');
    expect((err as ProviderError).message).toContain('timed out');
  });

  it('maps an unparseable 2xx body to "bad_response"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<<not json>>', { status: 200 })));
    const err = await requestJson({ provider: 'openai', url: 'https://x/y' }).catch((e: unknown) => e);
    expect((err as ProviderError).code).toBe('bad_response');
  });

  it('parses and returns a 2xx JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ hi: 1 }), { status: 200 })));
    const json = await requestJson<{ hi: number }>({ provider: 'openai', url: 'https://x/y' });
    expect(json).toEqual({ hi: 1 });
  });
});
