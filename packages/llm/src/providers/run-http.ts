// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The streamed request every run is made with.
 *
 * Three things can end it, and each is told apart: the caller's own signal
 * (`aborted`), no first byte in time, and silence between two chunks (both
 * `timeout`). A total timeout would be wrong here: a reply that keeps coming
 * is healthy however long it takes.
 *
 * Redirects are refused. A provider's API never answers one, and following
 * one would send the key wherever it points.
 *
 * Everything that can carry the key back out (a refused request's body, a
 * broken stream's message, an error the provider wrote into the stream) goes
 * through `scrubSecret` before it is thrown.
 */
import { codeForStatus, scrubCause, scrubSecret } from './http.js';
import { ProviderError, type ProviderId } from './types.js';

export interface StreamRequestOptions {
  provider: ProviderId;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  apiKey?: string | undefined;
  signal?: AbortSignal | undefined;
  firstByteTimeoutMs: number;
  idleTimeoutMs: number;
  /** `sse`: the `data:` payloads of server-sent events. `lines`: each non-empty line. */
  mode: 'sse' | 'lines';
}

/** One server-sent event's data, with its event name when it had one. */
export interface StreamItem {
  event: string | null;
  data: string;
}

/** A broken stream as a `ProviderError`, never carrying the key. */
export function streamError(
  provider: ProviderId,
  code: ProviderError['code'],
  message: string,
  apiKey: string | undefined,
  extra: { status?: number; cause?: unknown } = {},
): ProviderError {
  return new ProviderError({
    provider,
    code,
    message: `${provider}: ${scrubSecret(message, apiKey)}`,
    ...(extra.status === undefined ? {} : { status: extra.status }),
    ...(extra.cause === undefined ? {} : { cause: scrubCause(extra.cause, apiKey) }),
  });
}

/** Read a streamed reply as items. Throws `ProviderError`. */
export async function* streamRequest(opts: StreamRequestOptions): AsyncGenerator<StreamItem, void, void> {
  const { provider, apiKey } = opts;
  const controller = new AbortController();
  let ended: 'caller' | 'first-byte' | 'idle' | null = null;
  const stopFor = (why: NonNullable<typeof ended>): void => {
    if (ended === null) ended = why;
    controller.abort();
  };
  const onCallerAbort = (): void => {
    stopFor('caller');
  };
  if (opts.signal?.aborted === true) throw streamError(provider, 'aborted', 'the run was stopped', apiKey);
  opts.signal?.addEventListener('abort', onCallerAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    stopFor('first-byte');
  }, opts.firstByteTimeoutMs);
  const idle = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      stopFor('idle');
    }, opts.idleTimeoutMs);
  };

  /** What an abort was for, as the error the caller sees. */
  const ending = (cause: unknown): ProviderError => {
    if (ended === 'caller') return streamError(provider, 'aborted', 'the run was stopped', apiKey);
    if (ended === 'first-byte') {
      return streamError(provider, 'timeout', `no reply began within ${String(Math.round(opts.firstByteTimeoutMs / 1000))} s`, apiKey);
    }
    if (ended === 'idle') {
      return streamError(provider, 'timeout', `the reply stopped arriving for ${String(Math.round(opts.idleTimeoutMs / 1000))} s`, apiKey);
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    return streamError(provider, 'network', `the connection failed (${detail})`, apiKey, { cause });
  };

  try {
    let res: Response;
    try {
      res = await fetch(opts.url, {
        method: 'POST',
        headers: opts.headers,
        body: JSON.stringify(opts.body),
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (error) {
      throw ending(error);
    }
    // `manual` gives an opaque redirect in a browser and the 3xx itself in Node.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      throw streamError(provider, 'http', 'the provider answered a redirect, which is never followed', apiKey, { status: res.status });
    }
    if (!res.ok) {
      let raw = '';
      try {
        raw = (await res.text()).slice(0, 2000);
      } catch {
        // The status says enough.
      }
      const snippet = raw.length === 0 ? '' : ` — ${raw.slice(0, 500)}`;
      throw streamError(provider, codeForStatus(res.status), `HTTP ${String(res.status)}${snippet}`, apiKey, { status: res.status });
    }
    if (res.body === null) throw streamError(provider, 'bad_response', 'the reply had no body', apiKey, { status: res.status });

    const reader = res.body.getReader();
    // `stream: true` keeps a character that was cut in two between chunks whole.
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let event: string | null = null;
    let data: string[] = [];

    /** Take every whole line out of the buffer. */
    function* lines(final: boolean): Generator<string> {
      for (;;) {
        const at = buffer.indexOf('\n');
        if (at === -1) break;
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        yield line.endsWith('\r') ? line.slice(0, -1) : line;
      }
      if (final && buffer.length > 0) {
        const rest = buffer;
        buffer = '';
        yield rest;
      }
    }

    function* items(final: boolean): Generator<StreamItem> {
      for (const line of lines(final)) {
        if (opts.mode === 'lines') {
          if (line.trim() !== '') yield { event: null, data: line };
          continue;
        }
        if (line === '') {
          if (data.length > 0) yield { event, data: data.join('\n') };
          event = null;
          data = [];
        } else if (line.startsWith(':')) {
          // A comment: a keep-alive.
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        }
      }
      // A stream that ends without its last blank line still said what it said.
      if (final && opts.mode === 'sse' && data.length > 0) {
        yield { event, data: data.join('\n') };
        data = [];
      }
    }

    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          throw ending(error);
        }
        if (chunk.done) {
          buffer += decoder.decode();
          yield* items(true);
          return;
        }
        idle();
        buffer += decoder.decode(chunk.value, { stream: true });
        yield* items(false);
      }
    } finally {
      void reader.cancel().catch(() => undefined);
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onCallerAbort);
  }
}

/** A stream item's data as an object. Throws `bad_response` when it is not JSON. */
export function parseItem(provider: ProviderId, item: StreamItem, apiKey: string | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(item.data);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Said below.
  }
  throw streamError(provider, 'bad_response', `the stream carried something that is not a JSON object (${item.data.slice(0, 200)})`, apiKey);
}
