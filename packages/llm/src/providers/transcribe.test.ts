// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Turning a recording into text: OpenAI's route, and the servers that copy
 * it. What is asserted is what leaves (the address, the form, the key), what
 * comes back, and what an error may never hold.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProviderClient } from './factory.js';
import { ProviderError } from './types.js';

const KEY = 'sk-test-0123456789abcdef';
const AUDIO = new Uint8Array([1, 2, 3, 4, 5]);

interface Seen {
  url: string;
  init: RequestInit;
}

function answer(status: number, body: unknown): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init: RequestInit) => {
      seen.push({ url, init });
      return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    }),
  );
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a recording turned into text', () => {
  it('goes to OpenAI as one file with its model and language, and comes back as text', async () => {
    const seen = answer(200, { text: '  How many orders shipped today?  ' });
    const client = createProviderClient({ provider: 'openai', apiKey: KEY, model: 'gpt-x' });
    const said = await client.transcribe!({ audio: AUDIO, mime: 'audio/webm;codecs=opus', language: 'de' });
    expect(said).toEqual({ text: 'How many orders shipped today?' });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(seen[0]!.init.method).toBe('POST');
    // Never followed elsewhere: the address that was checked is the address that is called.
    expect(seen[0]!.init.redirect).toBe('manual');
    // The form's own boundary is the runtime's to write: no content-type is set by hand.
    expect(seen[0]!.init.headers).toEqual({ authorization: `Bearer ${KEY}` });
    const form = seen[0]!.init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('de');
    expect(form.get('response_format')).toBe('verbose_json');
    const file = form.get('file') as File;
    expect(file.name).toBe('speech.webm');
    expect(file.type).toBe('audio/webm');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(AUDIO);
  });

  it('hands back how long the service says the recording was, when it says', async () => {
    answer(200, { text: 'ok', duration: 93.4 });
    const client = createProviderClient({ provider: 'openai', apiKey: KEY, model: 'gpt-x' });
    expect(await client.transcribe!({ audio: AUDIO, mime: 'audio/webm' })).toEqual({ text: 'ok', seconds: 93.4 });
    answer(200, { text: 'ok', duration: 'long' });
    expect(await client.transcribe!({ audio: AUDIO, mime: 'audio/webm' })).toEqual({ text: 'ok' });
  });

  it('names the file by what the browser recorded, and sends a language only as two letters', async () => {
    const seen = answer(200, { text: 'ok' });
    const client = createProviderClient({ provider: 'openai', apiKey: KEY, model: 'gpt-x' });
    await client.transcribe!({ audio: AUDIO, mime: 'audio/mp4', language: 'de_DE', model: 'gpt-4o-mini-transcribe' });
    const form = seen[0]!.init.body as FormData;
    expect((form.get('file') as File).name).toBe('speech.m4a');
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(form.has('language')).toBe(false);
  });

  it('goes to a compatible server at its own address, with a key only when it has one', async () => {
    const seen = answer(200, { text: 'hello' });
    const open = createProviderClient({ provider: 'openai-compatible', baseUrl: 'http://models.internal:8000/v1/', model: 'm' });
    expect(await open.transcribe!({ audio: AUDIO, mime: 'audio/webm' })).toEqual({ text: 'hello' });
    expect(seen[0]!.url).toBe('http://models.internal:8000/v1/audio/transcriptions');
    expect(seen[0]!.init.headers).toBeUndefined();
    const keyed = createProviderClient({ provider: 'openai-compatible', baseUrl: 'http://models.internal:8000/v1', apiKey: KEY, model: 'm' });
    await keyed.transcribe!({ audio: AUDIO, mime: 'audio/webm' });
    expect(seen[1]!.init.headers).toEqual({ authorization: `Bearer ${KEY}` });
  });

  it('says what went wrong without the key or the recording: no such route, a reply with no text, a stop', async () => {
    answer(404, `{"error":"no route for ${KEY}"}`);
    const client = createProviderClient({ provider: 'openai-compatible', baseUrl: 'http://models.internal:8000/v1', apiKey: KEY, model: 'm' });
    const missing = await client.transcribe!({ audio: AUDIO, mime: 'audio/webm' }).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(ProviderError);
    expect((missing as ProviderError).code).toBe('not_found');
    expect((missing as ProviderError).message).not.toContain(KEY);

    answer(200, { words: [] });
    const empty = await client.transcribe!({ audio: AUDIO, mime: 'audio/webm' }).catch((error: unknown) => error);
    expect((empty as ProviderError).code).toBe('bad_response');

    // The person's own request went away: the call is stopped, and says so.
    const stop = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))),
    );
    const pending = client.transcribe!({ audio: AUDIO, mime: 'audio/webm', signal: stop.signal }).catch((error: unknown) => error);
    stop.abort();
    expect(((await pending) as ProviderError).code).toBe('aborted');
  });

  it('is offered only by the services that have it', () => {
    expect(typeof createProviderClient({ provider: 'openai', apiKey: KEY, model: 'm' }).transcribe).toBe('function');
    expect(typeof createProviderClient({ provider: 'openai-compatible', baseUrl: 'http://x.internal/v1', model: 'm' }).transcribe).toBe('function');
    expect(createProviderClient({ provider: 'anthropic', apiKey: KEY, model: 'm' }).transcribe).toBeUndefined();
    expect(createProviderClient({ provider: 'ollama', model: 'm' }).transcribe).toBeUndefined();
  });
});

describe('one way out', () => {
  it('no provider file calls fetch itself: every request goes through the checked door in http.ts', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const found: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      readFileSync(join(dir, name), 'utf8').split('\n').forEach((line, index) => {
        const code = line.replace(/\/\/.*$/, '');
        if (/(^|[^.\w])fetch\(/.test(code) && !line.trimStart().startsWith('*')) found.push(`${name}:${String(index + 1)}`);
      });
    }
    expect(found).toEqual([]);
  });
});
