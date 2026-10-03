// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Streamed runs: the request each provider is sent, and what its stream is
 * read as.
 *
 * The streams are replayed from `fixtures/streams/`, cut into chunks at
 * awkward byte boundaries (a real network splits lines, events and even
 * characters wherever it likes). The lenient reading of servers that only
 * claim to speak OpenAI's format is pinned case by case, because each case is
 * a server somebody runs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { anthropicMessages } from './run-anthropic.js';
import { canBuild, createProviderRunner, PROBE_PICTURE, readsImages } from './run-factory.js';
import { ollamaMessages } from './run-ollama.js';
import { openAiMessages } from './run-openai.js';
import { streamRequest } from './run-http.js';
import type { ProviderRunner, RunEvent, RunMessage, RunRequest, RunResult, RunTool } from './run-types.js';
import { ProviderError, type ProviderConfig } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = 'sk-test-0123456789abcdef';

/** A recorded stream, without the notes at its top. */
function fixture(name: string): string {
  const lines = readFileSync(join(HERE, 'fixtures', 'streams', `${name}.txt`), 'utf8').split('\n');
  while (lines[0]?.startsWith('# ') === true) lines.shift();
  return lines.join('\n');
}

/** A body that arrives `size` bytes at a time: lines, events and characters all get cut. */
function body(text: string, size = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

interface Sent {
  url: string;
  init: RequestInit;
  json: Record<string, unknown>;
}

/** Answer every request with the next reply in turn, and keep what was sent. */
function serve(...replies: (string | Response)[]): Sent[] {
  const sent: Sent[] = [];
  let next = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      sent.push({ url: String(url), init: init ?? {}, json: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      const reply = replies[Math.min(next, replies.length - 1)];
      next += 1;
      return typeof reply === 'string' ? new Response(body(reply), { status: 200 }) : (reply as Response);
    }),
  );
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const TOOLS: RunTool[] = [
  {
    name: 'write_file',
    description: 'Write a file.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  { name: 'read_file', description: 'Read a file.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'list_files', description: 'List files.', inputSchema: { type: 'object', properties: {} } },
];

const CONVERSATION: RunMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'Make a jobs table.' }] },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Reading first.' },
      { type: 'tool_call', id: 'c1', name: 'read_file', input: { path: 'a.json' } },
    ],
  },
  { role: 'user', content: [{ type: 'tool_result', callId: 'c1', content: '{}', isError: false }] },
];

const request = (over: Partial<RunRequest> = {}): RunRequest => ({
  system: 'You build apps.',
  messages: CONVERSATION,
  tools: TOOLS,
  model: 'the-model',
  maxTokens: 4000,
  ...over,
});

const runner = (config: ProviderConfig): ProviderRunner => createProviderRunner(config);
const ANTHROPIC = (): ProviderRunner => runner({ provider: 'anthropic', apiKey: KEY });
const OPENAI = (): ProviderRunner => runner({ provider: 'openai', apiKey: KEY });
const COMPATIBLE = (): ProviderRunner => runner({ provider: 'openai-compatible', baseUrl: 'http://box.test:8000/v1' });
const OLLAMA = (): ProviderRunner => runner({ provider: 'ollama' });

async function collect(run: ProviderRunner, over: Partial<RunRequest> = {}): Promise<{ result: RunResult; events: RunEvent[] }> {
  const events: RunEvent[] = [];
  const result = await run.run(request({ ...over, onEvent: (event) => events.push(event) }));
  return { result, events };
}

const textOf = (events: RunEvent[]): string => events.flatMap((event) => (event.type === 'text' ? [event.delta] : [])).join('');

// ── the stream reader ────────────────────────────────────────────────────────

describe('the streamed request', () => {
  const read = async (opts: Partial<Parameters<typeof streamRequest>[0]> = {}): Promise<string[]> => {
    const out: string[] = [];
    for await (const item of streamRequest({
      provider: 'openai',
      url: 'https://api.test/v1/x',
      headers: {},
      body: {},
      apiKey: KEY,
      firstByteTimeoutMs: 1000,
      idleTimeoutMs: 1000,
      mode: 'sse',
      ...opts,
    })) {
      out.push(item.data);
    }
    return out;
  };

  it('keeps a character whole when the network cuts it in two', async () => {
    serve(new Response(body('data: {"a":"wörld — 日本"}\n\n', 1), { status: 200 }));
    expect(await read()).toEqual(['{"a":"wörld — 日本"}']);
  });

  it('reads events that end with CRLF, skips comments, and gives a last event with no blank line after it', async () => {
    serve(new Response(body(': keep-alive\r\ndata: one\r\n\r\nevent: x\r\ndata: two\r\ndata: more', 5), { status: 200 }));
    expect(await read()).toEqual(['one', 'two\nmore']);
  });

  it('reads plain lines in line mode', async () => {
    serve(new Response(body('{"a":1}\n\n{"b":2}', 3), { status: 200 }));
    expect(await read({ mode: 'lines' })).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('never follows a redirect', async () => {
    const sent = serve(new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/' } }));
    await expect(read()).rejects.toMatchObject({ code: 'http', status: 302 });
    expect(sent[0]?.init.redirect).toBe('manual');
  });

  it('maps a refused request by its status, and never repeats the key back', async () => {
    serve(new Response(`{"error":"bad key ${KEY}"}`, { status: 401 }));
    const error = await read().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe('auth');
    expect((error as ProviderError).message).toContain('[REDACTED]');
    expect((error as ProviderError).message).not.toContain(KEY);
  });

  it('times out when no first byte comes, and says which wait ran out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    const pending = read({ firstByteTimeoutMs: 5000 }).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(5000);
    const error = (await pending) as ProviderError;
    expect(error.code).toBe('timeout');
    expect(error.message).toContain('no reply began within 5 s');
  });

  it('times out when a reply that started goes silent', async () => {
    vi.useFakeTimers();
    let push: ((chunk: Uint8Array) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            push = (chunk) => controller.enqueue(chunk);
            init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          },
        });
        return new Response(stream, { status: 200 });
      }),
    );
    const pending = read({ firstByteTimeoutMs: 60_000, idleTimeoutMs: 2000 }).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(10);
    push?.(new TextEncoder().encode('data: one\n\n'));
    // Past the idle wait, well inside the first-byte one.
    await vi.advanceTimersByTimeAsync(2500);
    const error = (await pending) as ProviderError;
    expect(error.code).toBe('timeout');
    expect(error.message).toContain('stopped arriving for 2 s');
  });

  it('ends as `aborted` when the caller stops it, before or during', async () => {
    const stopped = new AbortController();
    stopped.abort();
    serve('data: one\n\n');
    await expect(read({ signal: stopped.signal })).rejects.toMatchObject({ code: 'aborted' });

    const during = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: one\n\n'));
            init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          },
        });
        return new Response(stream, { status: 200 });
      }),
    );
    const seen: string[] = [];
    const run = (async () => {
      for await (const item of streamRequest({
        provider: 'openai',
        url: 'https://api.test/v1/x',
        headers: {},
        body: {},
        signal: during.signal,
        firstByteTimeoutMs: 1000,
        idleTimeoutMs: 1000,
        mode: 'sse',
      })) {
        seen.push(item.data);
        during.abort();
      }
    })();
    await expect(run).rejects.toMatchObject({ code: 'aborted' });
    expect(seen).toEqual(['one']);
  });
});

// ── Anthropic ────────────────────────────────────────────────────────────────

// ── Pictures ─────────────────────────────────────────────────────────────────

describe('a picture in a message', () => {
  const PIXEL = 'iVBORw0KGgo=';
  const withPicture: RunMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'Make it look like this.' }, { type: 'image', mediaType: 'image/png', data: PIXEL, ref: 'att_1', name: 'shot.png' }] },
  ];
  const kept: RunMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'Like this.' }, { type: 'image', mediaType: 'image/png', data: '', ref: 'att_1' }] }];

  it('Anthropic: a base64 image block, and nothing of our own bookkeeping', () => {
    expect(anthropicMessages(withPicture)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Make it look like this.' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PIXEL } }] },
    ]);
    expect(anthropicMessages(kept)).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Like this.' }] }]);
  });

  it('OpenAI and compatible: the message becomes parts, with the picture as a data URL', () => {
    expect(openAiMessages('', withPicture)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Make it look like this.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${PIXEL}` } }] },
    ]);
    // No bytes, no parts: the plain string every compatible server reads.
    expect(openAiMessages('', kept)).toEqual([{ role: 'user', content: 'Like this.' }]);
  });

  it('Ollama: the bytes beside the words', () => {
    expect(ollamaMessages('', withPicture)).toEqual([{ role: 'user', content: 'Make it look like this.', images: [PIXEL] }]);
    expect(ollamaMessages('', kept)).toEqual([{ role: 'user', content: 'Like this.' }]);
    expect(ollamaMessages('', [{ role: 'user', content: [{ type: 'image', mediaType: 'image/png', data: PIXEL }] }])).toEqual([{ role: 'user', content: '', images: [PIXEL] }]);
  });
});

describe('whether a model reads pictures', () => {
  const answering = (reply: string | Error): ProviderRunner => ({
    id: 'ollama',
    run: async (req) => {
      if (reply instanceof Error) throw reply;
      // The picture went with the question, and no tool.
      expect(req.tools).toEqual([]);
      expect(req.messages[0]?.content[1]).toEqual({ type: 'image', mediaType: 'image/png', data: PROBE_PICTURE });
      return { blocks: [{ type: 'text', text: reply }], stop: 'end', malformed: [] };
    },
  });

  it('is asked: the two colours, in their order', async () => {
    expect(await readsImages(answering('Yellow, blue.'), 'm')).toBe(true);
    expect(await readsImages(answering('yellow\nBlue'), 'm')).toBe(true);
    // A guess, the wrong order, or "I cannot see it".
    expect(await readsImages(answering('Red and green'), 'm')).toBe(false);
    expect(await readsImages(answering('Blue, yellow'), 'm')).toBe(false);
    expect(await readsImages(answering('I cannot see any picture.'), 'm')).toBe(false);
  });

  it('a request refused for its picture is a no; a server that could not be asked is no verdict', async () => {
    expect(await readsImages(answering(new ProviderError({ provider: 'ollama', code: 'http', status: 400, message: 'this model does not support images' })), 'm')).toBe(false);
    expect(await readsImages(answering(new ProviderError({ provider: 'ollama', code: 'network', message: 'offline' })), 'm')).toBeNull();
    expect(await readsImages(answering(new ProviderError({ provider: 'ollama', code: 'rate_limit', status: 429, message: 'slow down' })), 'm')).toBeNull();
    await expect(readsImages(answering(new ProviderError({ provider: 'ollama', code: 'aborted', message: 'stopped' })), 'm')).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('a run against Anthropic', () => {
  it('sends blocks, tools and no temperature, with a cache mark after the system text and on the last block', async () => {
    const sent = serve(fixture('anthropic-text'));
    await ANTHROPIC().run(request());
    expect(sent[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0]?.init.headers).toMatchObject({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01' });
    expect(sent[0]?.json).toEqual({
      model: 'the-model',
      max_tokens: 4000,
      stream: true,
      system: [{ type: 'text', text: 'You build apps.', cache_control: { type: 'ephemeral' } }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Make a jobs table.' }] },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Reading first.' },
            { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'a.json' } },
          ],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{}', cache_control: { type: 'ephemeral' } }] },
      ],
      tools: TOOLS.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
    });
  });

  it('counts what the cache read or wrote as tokens sent', async () => {
    serve(fixture('anthropic-text').replace('"input_tokens":25', '"input_tokens":25,"cache_creation_input_tokens":100,"cache_read_input_tokens":9000'));
    const { result } = await collect(ANTHROPIC());
    expect(result.usage).toEqual({ inputTokens: 9125, outputTokens: 12 });
  });

  it('keeps that count when the closing event gives the uncached number again', async () => {
    serve(
      fixture('anthropic-text')
        .replace('"input_tokens":25', '"input_tokens":25,"cache_creation_input_tokens":100,"cache_read_input_tokens":9000')
        .replace('"output_tokens":12', '"input_tokens":25,"cache_creation_input_tokens":100,"cache_read_input_tokens":9000,"output_tokens":12'),
    );
    expect((await collect(ANTHROPIC())).result.usage).toEqual({ inputTokens: 9125, outputTokens: 12 });
    // A closing event with the bare number does not take the cache's share away…
    serve(
      fixture('anthropic-text')
        .replace('"input_tokens":25', '"input_tokens":25,"cache_read_input_tokens":9000')
        .replace('"output_tokens":12', '"input_tokens":25,"output_tokens":12'),
    );
    expect((await collect(ANTHROPIC())).result.usage).toEqual({ inputTokens: 9025, outputTokens: 12 });
    // …and with nothing cached at all, it is the whole count.
    serve(fixture('anthropic-text').replace('"output_tokens":12', '"input_tokens":25,"output_tokens":12'));
    expect((await collect(ANTHROPIC())).result.usage).toEqual({ inputTokens: 25, outputTokens: 12 });
  });

  it('reads text as it comes', async () => {
    serve(fixture('anthropic-text'));
    const { result, events } = await collect(ANTHROPIC());
    expect(result).toEqual({
      blocks: [{ type: 'text', text: 'Hello, wörld — done.' }],
      stop: 'end',
      malformed: [],
      usage: { inputTokens: 25, outputTokens: 12 },
    });
    expect(textOf(events)).toBe('Hello, wörld — done.');
  });

  it('puts a tool call’s arguments together from their pieces', async () => {
    serve(fixture('anthropic-one-tool'));
    const { result, events } = await collect(ANTHROPIC());
    expect(result.stop).toBe('tool_calls');
    expect(result.blocks).toEqual([
      { type: 'text', text: "I'll write the table." },
      {
        type: 'tool_call',
        id: 'toolu_0000000000000000000001',
        name: 'write_file',
        input: { path: 'apps/repairs/manifest/tables/jobs.json', content: '{"ref": "jobs"}' },
      },
    ]);
    expect(events.filter((event) => event.type === 'tool_call')).toEqual([
      { type: 'tool_call', id: 'toolu_0000000000000000000001', name: 'write_file' },
    ]);
  });

  it('reads two calls, one of them with no arguments at all', async () => {
    serve(fixture('anthropic-two-tools'));
    const { result } = await collect(ANTHROPIC());
    expect(result.blocks).toEqual([
      { type: 'tool_call', id: 'toolu_0000000000000000000001', name: 'read_file', input: { path: 'apps/repairs/manifest/app.json' } },
      { type: 'tool_call', id: 'toolu_0000000000000000000002', name: 'list_files', input: {} },
    ]);
    expect(result.malformed).toEqual([]);
  });

  it('keeps a call it cannot read, and says so, instead of failing', async () => {
    serve(fixture('anthropic-bad-arguments'));
    const { result } = await collect(ANTHROPIC());
    expect(result.blocks).toEqual([{ type: 'tool_call', id: 'toolu_0000000000000000000001', name: 'write_file', input: {} }]);
    expect(result.malformed).toHaveLength(1);
    expect(result.malformed[0]).toMatchObject({ id: 'toolu_0000000000000000000001', name: 'write_file' });
    expect(result.malformed[0]?.error).toContain('not valid JSON');
  });

  it('says a call was cut off when the tokens ran out in the middle of it', async () => {
    serve(fixture('anthropic-max-tokens'));
    const { result } = await collect(ANTHROPIC());
    expect(result.stop).toBe('max_tokens');
    expect(result.malformed).toEqual([expect.objectContaining({ name: 'write_file', error: 'the call was cut off before its arguments were complete' })]);
  });

  it('turns an error written into the stream into a ProviderError', async () => {
    serve(fixture('anthropic-in-stream-error'));
    await expect(ANTHROPIC().run(request())).rejects.toMatchObject({ code: 'server', provider: 'anthropic' });
  });

  it('refuses a reply that ends before it was complete', async () => {
    serve('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n');
    await expect(ANTHROPIC().run(request())).rejects.toMatchObject({ code: 'bad_response' });
  });
});

// ── OpenAI ───────────────────────────────────────────────────────────────────

describe('a run against OpenAI', () => {
  it('sends max_completion_tokens, asks for usage, and puts each tool result in a message of its own', async () => {
    const sent = serve(fixture('openai-text'));
    await OPENAI().run(request());
    expect(sent[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(sent[0]?.init.headers).toMatchObject({ authorization: `Bearer ${KEY}` });
    const json = sent[0]?.json ?? {};
    expect(json).not.toHaveProperty('temperature');
    expect(json).not.toHaveProperty('max_tokens');
    expect(json).toMatchObject({ model: 'the-model', stream: true, stream_options: { include_usage: true }, max_completion_tokens: 4000 });
    expect(json['messages']).toEqual([
      { role: 'system', content: 'You build apps.' },
      { role: 'user', content: 'Make a jobs table.' },
      {
        role: 'assistant',
        content: 'Reading first.',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.json"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{}' },
    ]);
    expect((json['tools'] as unknown[])[0]).toEqual({
      type: 'function',
      function: { name: 'write_file', description: 'Write a file.', parameters: TOOLS[0]?.inputSchema },
    });
  });

  it('reads text, and usage from the last chunk', async () => {
    serve(fixture('openai-text'));
    const { result, events } = await collect(OPENAI());
    expect(result).toEqual({
      blocks: [{ type: 'text', text: 'Hello, wörld — done.' }],
      stop: 'end',
      malformed: [],
      usage: { inputTokens: 25, outputTokens: 12 },
    });
    expect(textOf(events)).toBe('Hello, wörld — done.');
  });

  it('puts a call together from fragments keyed by index', async () => {
    serve(fixture('openai-one-tool'));
    const { result, events } = await collect(OPENAI());
    expect(result.stop).toBe('tool_calls');
    expect(result.blocks).toEqual([
      {
        type: 'tool_call',
        id: 'call_000000000000000000000001',
        name: 'write_file',
        input: { path: 'apps/repairs/manifest/tables/jobs.json', content: '{"ref": "jobs"}' },
      },
    ]);
    expect(events).toEqual([{ type: 'tool_call', id: 'call_000000000000000000000001', name: 'write_file' }]);
  });

  it('keeps two calls apart when their fragments arrive interleaved', async () => {
    serve(fixture('openai-two-tools'));
    const { result } = await collect(OPENAI());
    expect(result.blocks).toEqual([
      { type: 'text', text: 'Reading first.' },
      { type: 'tool_call', id: 'call_000000000000000000000001', name: 'read_file', input: { path: 'apps/repairs/manifest/app.json' } },
      { type: 'tool_call', id: 'call_000000000000000000000002', name: 'list_files', input: {} },
    ]);
  });

  it('says the tokens ran out', async () => {
    serve(fixture('openai-max-tokens'));
    expect((await collect(OPENAI())).result.stop).toBe('max_tokens');
  });
});

// ── servers that say they speak OpenAI's format ──────────────────────────────

describe('a run against an OpenAI-compatible server', () => {
  const chunk = (delta: Record<string, unknown>, finish: string | null = null): string =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const DONE = 'data: [DONE]\n\n';

  it('sends max_tokens, and a key only when it has one', async () => {
    const sent = serve(fixture('openai-text'));
    await COMPATIBLE().run(request());
    expect(sent[0]?.url).toBe('http://box.test:8000/v1/chat/completions');
    expect(sent[0]?.json).toMatchObject({ max_tokens: 4000 });
    expect(sent[0]?.json).not.toHaveProperty('max_completion_tokens');
    expect(sent[0]?.init.headers).not.toHaveProperty('authorization');
  });

  it('reads a call sent whole, with no index and no id, and gives it an id', async () => {
    serve(chunk({ tool_calls: [{ function: { name: 'read_file', arguments: '{"path":"a.json"}' } }] }) + chunk({}, 'tool_calls') + DONE);
    const { result } = await collect(COMPATIBLE());
    expect(result.blocks).toEqual([{ type: 'tool_call', id: 'call_1', name: 'read_file', input: { path: 'a.json' } }]);
    expect(result.usage).toBeUndefined();
  });

  it('reads arguments that arrive as an object', async () => {
    serve(chunk({ tool_calls: [{ index: 0, id: 'x1', function: { name: 'read_file', arguments: { path: 'a.json' } } }] }) + chunk({}, 'tool_calls') + DONE);
    expect((await collect(COMPATIBLE())).result.blocks).toEqual([{ type: 'tool_call', id: 'x1', name: 'read_file', input: { path: 'a.json' } }]);
  });

  it('continues the open call when later fragments carry neither index nor id', async () => {
    serve(
      chunk({ tool_calls: [{ id: 'x1', function: { name: 'read_file', arguments: '{"pa' } }] }) +
        chunk({ tool_calls: [{ function: { arguments: 'th":"a.json"}' } }] }) +
        chunk({}, 'tool_calls') +
        DONE,
    );
    expect((await collect(COMPATIBLE())).result.blocks).toEqual([{ type: 'tool_call', id: 'x1', name: 'read_file', input: { path: 'a.json' } }]);
  });

  it('reads two calls sent in one fragment list with no index', async () => {
    serve(
      chunk({
        tool_calls: [
          { function: { name: 'read_file', arguments: '{"path":"a.json"}' } },
          { function: { name: 'list_files', arguments: '{}' } },
        ],
      }) +
        chunk({}, 'stop') +
        DONE,
    );
    const { result } = await collect(COMPATIBLE());
    expect(result.blocks.map((block) => (block.type === 'tool_call' ? [block.id, block.name] : null))).toEqual([
      ['call_1', 'read_file'],
      ['call_2', 'list_files'],
    ]);
    // It said "stop", and it called tools: the calls win.
    expect(result.stop).toBe('tool_calls');
  });

  it('ends cleanly when the server never sends [DONE]', async () => {
    serve(chunk({ content: 'Hi' }) + chunk({}, 'stop'));
    expect((await collect(COMPATIBLE())).result).toMatchObject({ blocks: [{ type: 'text', text: 'Hi' }], stop: 'end' });
  });

  it('asks again without stream_options when the server refuses that field', async () => {
    const sent = serve(new Response('{"error":{"message":"Unrecognized request argument: stream_options"}}', { status: 400 }), chunk({ content: 'Hi' }) + chunk({}, 'stop') + DONE);
    const { result } = await collect(COMPATIBLE());
    expect(result.blocks).toEqual([{ type: 'text', text: 'Hi' }]);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.json).toHaveProperty('stream_options');
    expect(sent[1]?.json).not.toHaveProperty('stream_options');
  });

  it('does not ask twice for any other refusal', async () => {
    const sent = serve(new Response('{"error":{"message":"model not found"}}', { status: 400 }));
    await expect(COMPATIBLE().run(request())).rejects.toMatchObject({ code: 'http', status: 400 });
    expect(sent).toHaveLength(1);
  });

  it('reads a recorded reply whose reasoning comes in its own field, and its usage', async () => {
    serve(fixture('openai-compatible-text'));
    const { result, events } = await collect(COMPATIBLE());
    expect(result).toEqual({
      blocks: [{ type: 'text', text: 'Hello, wörld!' }],
      stop: 'end',
      malformed: [],
      usage: { inputTokens: 98, outputTokens: 92 },
    });
    expect(textOf(events)).toBe('Hello, wörld!');
  });

  it('reads a recorded call', async () => {
    serve(fixture('openai-compatible-one-tool'));
    const { result } = await collect(COMPATIBLE());
    expect(result.stop).toBe('tool_calls');
    expect(result.blocks).toEqual([
      { type: 'tool_call', id: 'call_000000000000000000000001', name: 'write_file', input: { path: 'apps/repairs/manifest/tables/jobs.json', content: '{"ref": "jobs"}' } },
    ]);
  });

  it('reads two recorded calls', async () => {
    serve(fixture('openai-compatible-two-tools'));
    const { result } = await collect(COMPATIBLE());
    expect(result.stop).toBe('tool_calls');
    expect(result.malformed).toEqual([]);
    expect(result.blocks).toEqual([
      { type: 'tool_call', id: 'call_000000000000000000000001', name: 'list_files', input: {} },
      { type: 'tool_call', id: 'call_000000000000000000000002', name: 'write_file', input: { content: '{}', path: 'a.json' } },
    ]);
  });

  it('says the tokens ran out on a recorded reply that got no further than its reasoning', async () => {
    serve(fixture('openai-compatible-max-tokens'));
    const { result } = await collect(COMPATIBLE());
    expect(result.stop).toBe('max_tokens');
    expect(result.blocks).toEqual([]);
  });

  it('turns an error chunk into a ProviderError', async () => {
    serve(chunk({ content: 'Sta' }) + 'data: {"error":{"message":"CUDA out of memory"}}\n\n');
    await expect(COMPATIBLE().run(request())).rejects.toMatchObject({ code: 'server' });
  });
});

// ── Ollama ───────────────────────────────────────────────────────────────────

describe('a run against Ollama', () => {
  it('sends object arguments and names the tool on a result', async () => {
    const sent = serve(fixture('ollama-text'));
    await OLLAMA().run(request());
    expect(sent[0]?.url).toBe('http://localhost:11434/api/chat');
    const json = sent[0]?.json ?? {};
    expect(json).toMatchObject({ model: 'the-model', stream: true, options: { num_predict: 4000, num_ctx: 32_768 } });
    expect(json['options']).not.toHaveProperty('temperature');
    expect(json['messages']).toEqual([
      { role: 'system', content: 'You build apps.' },
      { role: 'user', content: 'Make a jobs table.' },
      { role: 'assistant', content: 'Reading first.', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.json' } } }] },
      { role: 'tool', content: '{}', tool_name: 'read_file' },
    ]);
  });

  it('reads text and the counts on the last line, and leaves the thinking out', async () => {
    serve(fixture('ollama-text'));
    const { result, events } = await collect(OLLAMA());
    expect(result).toEqual({
      blocks: [{ type: 'text', text: 'Hello, wörld!' }],
      stop: 'end',
      malformed: [],
      usage: { inputTokens: 98, outputTokens: 58 },
    });
    expect(textOf(events)).toBe('Hello, wörld!');
  });

  it('reads a call with the id it came with, and says tools were called although the line says "stop"', async () => {
    serve(fixture('ollama-one-tool'));
    const { result } = await collect(OLLAMA());
    expect(result.stop).toBe('tool_calls');
    expect(result.blocks).toEqual([
      { type: 'tool_call', id: 'call_000000000000000000000001', name: 'write_file', input: { path: 'apps/repairs/manifest/tables/jobs.json', content: '{"ref": "jobs"}' } },
    ]);
  });

  it('gives a call an id when the server sends none', async () => {
    serve(
      '{"message":{"role":"assistant","content":"Writing it.","tool_calls":[{"function":{"name":"list_files","arguments":{}}}]},"done":false}\n' +
        '{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":1,"eval_count":1}\n',
    );
    const { result } = await collect(OLLAMA());
    expect(result.stop).toBe('tool_calls');
    expect(result.blocks).toEqual([
      { type: 'text', text: 'Writing it.' },
      { type: 'tool_call', id: 'call_1', name: 'list_files', input: {} },
    ]);
  });

  it('reads two calls that arrive on two lines', async () => {
    serve(fixture('ollama-two-tools'));
    const { result } = await collect(OLLAMA());
    expect(result.stop).toBe('tool_calls');
    expect(result.malformed).toEqual([]);
    expect(result.blocks).toEqual([
      { type: 'tool_call', id: 'call_000000000000000000000001', name: 'list_files', input: {} },
      { type: 'tool_call', id: 'call_000000000000000000000002', name: 'write_file', input: { content: '{}', path: 'a.json' } },
    ]);
  });

  it('says the tokens ran out when the line says "length", even with nothing but thinking', async () => {
    serve(fixture('ollama-max-tokens'));
    const { result } = await collect(OLLAMA());
    expect(result.stop).toBe('max_tokens');
    expect(result.blocks).toEqual([]);
  });

  it('turns an error line in the middle of a reply into a ProviderError', async () => {
    serve(fixture('ollama-in-stream-error'));
    await expect(OLLAMA().run(request())).rejects.toMatchObject({ code: 'server', provider: 'ollama' });
  });

  it('refuses a reply with no last line', async () => {
    serve('{"message":{"role":"assistant","content":"Hi"},"done":false}\n');
    await expect(OLLAMA().run(request())).rejects.toMatchObject({ code: 'bad_response' });
  });
});

// ── can it build? ────────────────────────────────────────────────────────────

describe('whether a model can be built with', () => {
  /** A runner that answers each run in turn. */
  const scripted = (...steps: (RunResult | Error)[]): ProviderRunner & { requests: RunRequest[] } => {
    const requests: RunRequest[] = [];
    let next = 0;
    return {
      id: 'openai-compatible',
      requests,
      async run(req) {
        requests.push(req);
        const step = steps[next];
        next += 1;
        if (step instanceof Error) throw step;
        return step as RunResult;
      },
    };
  };
  const called = (word: string, usage = true): RunResult => ({
    blocks: [{ type: 'tool_call', id: 'c1', name: 'echo', input: { word } }],
    stop: 'tool_calls',
    malformed: [],
    ...(usage ? { usage: { inputTokens: 10, outputTokens: 5 } } : {}),
  });
  const said = (text: string, usage = true): RunResult => ({
    blocks: [{ type: 'text', text }],
    stop: 'end',
    malformed: [],
    ...(usage ? { usage: { inputTokens: 10, outputTokens: 5 } } : {}),
  });

  it('passes a model that calls the tool and takes its answer, and sends the answer back as a result', async () => {
    const model = scripted(called('adminium'), said('done'));
    expect(await canBuild(model, 'm')).toEqual({ canBuild: true, reportsUsage: true });
    const second = model.requests[1]?.messages ?? [];
    expect(second[1]).toEqual({ role: 'assistant', content: [{ type: 'tool_call', id: 'c1', name: 'echo', input: { word: 'adminium' } }] });
    expect(second[2]?.content[0]).toEqual({ type: 'tool_result', callId: 'c1', content: 'adminium' });
  });

  it('notes a server that reports no usage', async () => {
    expect(await canBuild(scripted(called('adminium', false), said('done', false)), 'm')).toEqual({ canBuild: true, reportsUsage: false });
  });

  it('fails a server that ignores tools and answers in words', async () => {
    expect(await canBuild(scripted(said('adminium')), 'm')).toMatchObject({ canBuild: false, reason: 'no-tool-call' });
  });

  it('fails a model that calls the tool with something else', async () => {
    expect(await canBuild(scripted(called('hello')), 'm')).toMatchObject({ canBuild: false, reason: 'no-tool-call' });
  });

  it('fails a server that refuses the message carrying the tool’s answer', async () => {
    const refused = new ProviderError({ provider: 'openai-compatible', code: 'http', status: 400, message: 'role "tool" is not supported' });
    const verdict = await canBuild(scripted(called('adminium'), refused), 'm');
    expect(verdict).toMatchObject({ canBuild: false, reason: 'refused-result' });
    expect(verdict.canBuild === false ? verdict.message : '').toContain('role "tool" is not supported');
  });

  it('reports an unreachable server as an error, and lets the caller’s own stop through', async () => {
    const down = new ProviderError({ provider: 'openai-compatible', code: 'network', message: 'connection refused' });
    expect(await canBuild(scripted(down), 'm')).toMatchObject({ canBuild: false, reason: 'error', code: 'network' });
    // A refused key is not a verdict on the model either: its code says what happened.
    const refused = new ProviderError({ provider: 'anthropic', code: 'auth', status: 401, message: 'invalid x-api-key' });
    expect(await canBuild(scripted(refused), 'm')).toMatchObject({ canBuild: false, reason: 'error', code: 'auth' });
    const stopped = new ProviderError({ provider: 'openai-compatible', code: 'aborted', message: 'stopped' });
    await expect(canBuild(scripted(stopped), 'm')).rejects.toBe(stopped);
  });
});

describe('the runner factory', () => {
  it('refuses a provider that has no runner', () => {
    expect(() => createProviderRunner({ provider: 'adminium-managed' })).toThrow(ProviderError);
  });
});
